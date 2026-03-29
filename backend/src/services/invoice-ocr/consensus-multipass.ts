import { InvoiceData, ConsensusAnalysis, FieldConflict, OCRLineItem } from '@shared/types';
import { logger } from '../../utils/logger';
import {
  validateField,
  validateCrossFields,
  calculateFieldConsistency,
  FieldValidation,
} from './validation';
import { normalizeDateToUS, roundAmount } from './utils';
import { normalizeVendorName } from './vendor-mappings';

/**
 * Multi-pass result for a single model (multiple runs)
 */
export interface ModelMultiPassResult {
  modelName: string;
  runs: (InvoiceData | null)[];
  successfulRuns: number;
}

/**
 * Enhanced consensus analyzer with multi-pass support and validation
 * Based on research: ensemble voting + validation for confidence scoring
 */
export class MultiPassConsensusAnalyzer {
  private modelResults: ModelMultiPassResult[];
  private consensus: Record<string, string | number | string[]> = {};
  private conflicts: Record<string, FieldConflict> = {};
  private missing: Record<string, string> = {};
  private fieldValidations: Record<string, FieldValidation> = {};
  private fieldConsistencyScores: Record<string, number> = {};
  private confidenceScores: Record<string, number> = {};

  constructor(modelResults: ModelMultiPassResult[]) {
    this.modelResults = modelResults;
  }

  /**
   * Analyze consensus across all models and runs with validation
   */
  analyze(): ConsensusAnalysis & {
    field_confidence_scores: Record<string, number>;
    field_consistency: Record<string, number>;
    validation_issues: string[];
    low_confidence_fields: string[];
  } {
    if (this.modelResults.length === 0) {
      logger.warn('No model results to analyze');
      return {
        consensus: {},
        conflicts: {},
        missing: {},
        confidence_score: 0.0,
        review_needed: [],
        field_confidence_scores: {},
        field_consistency: {},
        validation_issues: [],
        low_confidence_fields: [],
      };
    }

    // Get all possible fields
    const allFields = this.getAllFields();

    // Analyze each field (skip line_items as it's handled separately)
    for (const field of allFields) {
      if (field === 'line_items') {
        // Line items are complex arrays of objects - use advanced selection strategy
        // Strategy: Choose the extraction with the most line items from the most reliable model
        let bestLineItems: OCRLineItem[] = [];
        let bestLineItemCount = 0;
        let bestModelName = '';

        for (const modelResult of this.modelResults) {
          for (const run of modelResult.runs) {
            if (run && run.line_items && Array.isArray(run.line_items) && run.line_items.length > 0) {
              // Prefer the extraction with more line items (more complete data)
              if (run.line_items.length > bestLineItemCount) {
                bestLineItems = run.line_items;
                bestLineItemCount = run.line_items.length;
                bestModelName = modelResult.modelName;
              }
            }
          }
        }

        if (bestLineItemCount > 0) {
          this.consensus.line_items = bestLineItems as unknown as string[];
          logger.info(
            { model: bestModelName, lineItemCount: bestLineItemCount },
            'Line items selected from model with most complete data'
          );
        } else {
          // No line items found in any model - set empty array
          this.consensus.line_items = [];
        }
        continue;
      }
      this.analyzeFieldMultiPass(field);
    }

    // Cross-field validation
    const crossValidation = this.performCrossValidation();

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence();

    // Get validation issues
    const allIssues = this.getAllIssues(crossValidation);

    // Get low confidence fields (< 70%)
    const lowConfidenceFields = Object.entries(this.confidenceScores)
      .filter(([_, score]) => score < 0.7)
      .map(([field]) => field);

    const analysis = {
      consensus: this.consensus,
      conflicts: this.conflicts,
      missing: this.missing,
      confidence_score: Math.round(overallConfidence * 1000) / 10, // Round to 1 decimal
      review_needed: this.getReviewItems(),
      field_confidence_scores: this.confidenceScores,
      field_consistency: this.fieldConsistencyScores,
      validation_issues: allIssues,
      low_confidence_fields: lowConfidenceFields,
    };

    logger.info(
      {
        consensusFields: Object.keys(analysis.consensus).length,
        conflictFields: Object.keys(analysis.conflicts).length,
        missingFields: Object.keys(analysis.missing).length,
        confidenceScore: analysis.confidence_score,
        validationIssues: allIssues.length,
      },
      'Multi-pass consensus analysis complete'
    );

    return analysis;
  }

  /**
   * Get all possible fields from all runs of all models
   */
  private getAllFields(): Set<string> {
    const fields = new Set<string>();

    for (const modelResult of this.modelResults) {
      for (const run of modelResult.runs) {
        if (run) {
          Object.keys(run).forEach((key) => fields.add(key));
        }
      }
    }

    return fields;
  }

  /**
   * Analyze a single field across all models and all runs
   * Uses majority voting and consistency checking
   */
  private analyzeFieldMultiPass(field: string): void {
    const allValues: (string | number | string[] | null | undefined)[] = [];
    const modelAgreements: Record<string, unknown> = {};

    // Collect values from all runs of all models
    for (const modelResult of this.modelResults) {
      const modelValues: (string | number | string[] | null | undefined)[] = [];

      for (const run of modelResult.runs) {
        if (run && field in run) {
          const value = run[field as keyof InvoiceData];
          // Type guard: only accept simple types (line_items should be skipped in the caller)
          if (value !== null && value !== undefined) {
            if (typeof value === 'string' || typeof value === 'number' || (Array.isArray(value) && value.every(v => typeof v === 'string'))) {
              allValues.push(value as string | number | string[]);
              modelValues.push(value as string | number | string[]);
            }
          }
        }
      }

      // Use most common value from this model (majority voting)
      if (modelValues.length > 0) {
        const mostCommon = this.getMostCommonValue(modelValues);
        modelAgreements[modelResult.modelName] = mostCommon;
      }
    }

    // No data for this field
    if (allValues.length === 0) {
      this.missing[field] = `Missing from all ${this.modelResults.length} models`;
      this.fieldConsistencyScores[field] = 0.0;
      this.confidenceScores[field] = 0.0;
      return;
    }

    // Calculate overall consistency across all runs
    const overallConsistency = calculateFieldConsistency(allValues);
    this.fieldConsistencyScores[field] = overallConsistency;

    // Get final value (majority voting across all runs)
    const finalValue = this.getMostCommonValue(allValues);

    // Validate the final value
    const fieldValidation = validateField(field, finalValue);
    this.fieldValidations[field] = fieldValidation;

    // Calculate confidence score for this field
    // 60% consistency + 40% validation (matches Python approach)
    const fieldConfidence = overallConsistency * 0.6 + fieldValidation.confidence * 0.4;
    this.confidenceScores[field] = fieldConfidence;

    // Determine if this is consensus or conflict
    const uniqueModelValues = new Set(
      Object.values(modelAgreements).map((v) => this.stringifyValue(v))
    );

    // Normalize vendor names to standard format
    let normalizedFinalValue = finalValue;
    if (field === 'vendor' && typeof finalValue === 'string') {
      normalizedFinalValue = normalizeVendorName(finalValue);
    }

    if (uniqueModelValues.size === 1 && overallConsistency >= 0.7) {
      // Strong consensus
      // Normalize date fields to MM/DD/YYYY format
      if (this.isDateField(field) && typeof finalValue === 'string') {
        this.consensus[field] = normalizeDateToUS(finalValue);
      }
      // Round amount fields to 2 decimal places
      else if (this.isAmountField(field) && typeof finalValue === 'number') {
        this.consensus[field] = roundAmount(finalValue);
      } else {
        this.consensus[field] = normalizedFinalValue;
      }
    } else {
      // Conflict or weak agreement
      this.conflicts[field] = {
        ...modelAgreements,
        _consistency: overallConsistency,
        _final_value: normalizedFinalValue,
      };
    }
  }

  /**
   * Check if a field is a date field
   */
  private isDateField(field: string): boolean {
    const dateFields = [
      'invoice_date',
      'due_date',
      'performance_period_start',
      'performance_period_end',
      'booking_date',
    ];
    return dateFields.includes(field);
  }

  /**
   * Check if a field is an amount field
   */
  private isAmountField(field: string): boolean {
    const amountFields = [
      'net_amount',
      'vat_amount',
      'vat_percentage',
      'gross_amount',
    ];
    return amountFields.includes(field);
  }

  /**
   * Get most common value from an array (majority voting)
   */
  private getMostCommonValue(
    values: (string | number | string[] | null | undefined)[]
  ): string | number | string[] {
    // Filter out null/undefined/empty
    const nonEmpty = values.filter(
      (v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
    );

    if (nonEmpty.length === 0) {
      return '';
    }

    // Count occurrences
    const counts = new Map<string, { value: unknown; count: number }>();

    for (const value of nonEmpty) {
      const key = this.stringifyValue(value);
      if (counts.has(key)) {
        counts.get(key)!.count++;
      } else {
        counts.set(key, { value, count: 1 });
      }
    }

    // Return most common
    let maxCount = 0;
    let mostCommon: unknown = nonEmpty[0];

    for (const { value, count } of counts.values()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = value;
      }
    }

    return mostCommon as string | number | string[];
  }

  /**
   * Convert value to string for comparison
   */
  private stringifyValue(value: unknown): string {
    if (Array.isArray(value)) {
      return JSON.stringify(value.sort());
    }
    return String(value);
  }

  /**
   * Perform cross-field validation
   */
  private performCrossValidation() {
    // Build data object from consensus
    const data: InvoiceData = {
      vendor: (this.consensus.vendor as string) || '',
      account_number: (this.consensus.account_number as string) || '',
      invoice_number: (this.consensus.invoice_number as string) || '',
      document_type: (this.consensus.document_type as string) || '',
      net_amount: (this.consensus.net_amount as number) || 0,
      vat_amount: (this.consensus.vat_amount as number) || 0,
      vat_percentage: (this.consensus.vat_percentage as number) || 0,
      gross_amount: (this.consensus.gross_amount as number) || 0,
      currency: (this.consensus.currency as string) || '',
      invoice_date: (this.consensus.invoice_date as string) || '',
      due_date: (this.consensus.due_date as string) || '',
      performance_period_start: (this.consensus.performance_period_start as string) || '',
      performance_period_end: (this.consensus.performance_period_end as string) || '',
      assigned_to: (this.consensus.assigned_to as string) || '',
      booking_date: (this.consensus.booking_date as string) || '',
    };

    return validateCrossFields(data);
  }

  /**
   * Calculate overall confidence score
   * Weighted average of all field confidence scores
   */
  private calculateOverallConfidence(): number {
    const scores = Object.values(this.confidenceScores);

    if (scores.length === 0) {
      return 0.0;
    }

    const sum = scores.reduce((a, b) => a + b, 0);
    return sum / scores.length;
  }

  /**
   * Get all validation issues
   */
  private getAllIssues(crossValidation: { issues: string[] }): string[] {
    const issues: string[] = [];

    // Field validation issues
    for (const [field, validation] of Object.entries(this.fieldValidations)) {
      for (const issue of validation.issues) {
        issues.push(`${field}: ${issue}`);
      }
    }

    // Cross-field validation issues
    issues.push(...crossValidation.issues);

    return issues;
  }

  /**
   * Get list of fields that need manual review
   */
  private getReviewItems(): string[] {
    const review: string[] = [];

    // Low confidence fields
    for (const [field, score] of Object.entries(this.confidenceScores)) {
      if (score < 0.7) {
        review.push(`Review ${field}: Low confidence (${(score * 100).toFixed(1)}%)`);
      }
    }

    // Conflicts
    for (const field of Object.keys(this.conflicts)) {
      review.push(`Review ${field}: Models disagree`);
    }

    // Missing
    for (const field of Object.keys(this.missing)) {
      review.push(`Review ${field}: Missing from all models`);
    }

    return review;
  }
}

/**
 * Log detailed consensus report
 */
export function logMultiPassConsensusReport(
  modelResults: ModelMultiPassResult[],
  analysis: ReturnType<MultiPassConsensusAnalyzer['analyze']>
): void {
  logger.info('='.repeat(80));
  logger.info('MULTI-PASS CONFIDENCE REPORT');
  logger.info('='.repeat(80));

  // Model statistics
  for (const modelResult of modelResults) {
    logger.info({
      model: modelResult.modelName,
      successfulRuns: modelResult.successfulRuns,
      totalRuns: modelResult.runs.length,
      successRate: `${((modelResult.successfulRuns / modelResult.runs.length) * 100).toFixed(1)}%`,
    });
  }

  logger.info(`\nOverall Confidence: ${analysis.confidence_score.toFixed(1)}%`);

  // Field-by-field confidence
  logger.info('\nFIELD-BY-FIELD CONFIDENCE:');
  const sortedFields = Object.entries(analysis.field_confidence_scores).sort((a, b) => b[1] - a[1]);

  for (const [field, score] of sortedFields) {
    const barLength = Math.floor(score * 20);
    const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
    const consistency = analysis.field_consistency[field] || 0;
    logger.info(`  ${field.padEnd(30)} ${bar} ${(score * 100).toFixed(1)}% (consistency: ${(consistency * 100).toFixed(1)}%)`);
  }

  // Issues
  if (analysis.validation_issues.length > 0) {
    logger.warn(`\nISSUES FOUND (${analysis.validation_issues.length}):`);
    for (const issue of analysis.validation_issues) {
      logger.warn(`  • ${issue}`);
    }
  }

  // Low confidence fields
  if (analysis.low_confidence_fields.length > 0) {
    logger.error(`\nLOW CONFIDENCE FIELDS (< 70%):`);
    for (const field of analysis.low_confidence_fields) {
      const score = analysis.field_confidence_scores[field];
      logger.error(`  • ${field}: ${(score * 100).toFixed(1)}% - REVIEW MANUALLY`);
    }
  }

  // Recommendation
  logger.info('\n' + '='.repeat(80));
  if (analysis.confidence_score >= 90) {
    logger.info('✅ EXCELLENT - Data is highly reliable');
  } else if (analysis.confidence_score >= 75) {
    logger.info('✅ GOOD - Data appears reliable, review low-confidence fields');
  } else if (analysis.confidence_score >= 50) {
    logger.warn('⚠️  MODERATE - Review flagged fields before using');
  } else {
    logger.error('❌ LOW - Extensive manual review required');
  }
  logger.info('='.repeat(80));
}
