import { InvoiceData, ConsensusAnalysis, FieldConflict } from '@shared/types';
import { logger } from '../../utils/logger';

/**
 * Analyzes results from multiple models and identifies consensus/conflicts
 */
export class ConsensusAnalyzer {
  private results: Record<string, InvoiceData | null>;
  private models: string[];
  private consensus: Record<string, string | number | string[]> = {};
  private conflicts: Record<string, FieldConflict> = {};
  private missing: Record<string, string> = {};

  constructor(results: Record<string, InvoiceData | null>) {
    this.results = results;
    this.models = Object.keys(results);
  }

  /**
   * Analyze consensus across all models
   */
  analyze(): ConsensusAnalysis {
    if (Object.keys(this.results).length === 0) {
      logger.warn('No results to analyze');
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

    // Get all possible fields from all models
    const allFields = new Set<string>();
    for (const data of Object.values(this.results)) {
      if (data) {
        Object.keys(data).forEach((key) => allFields.add(key));
      }
    }

    // Analyze each field (skip line_items as it's handled separately)
    for (const field of allFields) {
      if (field === 'line_items') {
        // Line items are complex objects and should be stored as-is from the first model that has them
        // They are not suitable for consensus analysis
        const firstModelWithLineItems = Object.values(this.results).find(
          (data) => data && data.line_items && data.line_items.length > 0
        );
        if (firstModelWithLineItems && firstModelWithLineItems.line_items) {
          this.consensus.line_items = firstModelWithLineItems.line_items as unknown as string[];
        }
        continue;
      }
      this.analyzeField(field);
    }

    const analysis: ConsensusAnalysis = {
      consensus: this.consensus,
      conflicts: this.conflicts,
      missing: this.missing,
      confidence_score: this.calculateConfidence(),
      review_needed: this.getReviewItems(),
      field_confidence_scores: {},  // TODO: Implement per-field confidence scoring
      field_consistency: {},         // TODO: Implement cross-model agreement metrics
      validation_issues: [],         // TODO: Implement field validation
      low_confidence_fields: [],     // TODO: Implement confidence thresholding
    };

    logger.info(
      {
        consensusFields: Object.keys(analysis.consensus).length,
        conflictFields: Object.keys(analysis.conflicts).length,
        missingFields: Object.keys(analysis.missing).length,
        confidenceScore: analysis.confidence_score,
      },
      'Consensus analysis complete'
    );

    return analysis;
  }

  /**
   * Analyze a single field across all models
   */
  private analyzeField(field: string): void {
    const values: Record<string, string | number | string[]> = {};

    for (const [model, data] of Object.entries(this.results)) {
      if (data && field in data) {
        const value = data[field as keyof InvoiceData];
        if (value !== null && value !== undefined) {
          // Type guard: only accept simple types (line_items should be skipped in the caller)
          if (typeof value === 'string' || typeof value === 'number' || (Array.isArray(value) && value.every(v => typeof v === 'string'))) {
            values[model] = value as string | number | string[];
          }
        }
      }
    }

    if (Object.keys(values).length === 0) {
      // Missing from all models
      this.missing[field] = `Missing from all ${this.models.length} models`;
    } else if (Object.keys(values).length === this.models.length) {
      // All models have this field
      const uniqueValues = new Set(
        Object.values(values).map((v) => this.stringifyValue(v))
      );

      if (uniqueValues.size === 1) {
        // Perfect consensus
        this.consensus[field] = Object.values(values)[0];
      } else {
        // Conflict
        this.conflicts[field] = values;
      }
    } else {
      // Partial data
      const missingFrom = this.models.filter((m) => !(m in values));
      this.conflicts[field] = {
        ...values,
        _missing_from: missingFrom,
      };
    }
  }

  /**
   * Convert value to string for comparison
   */
  private stringifyValue(value: string | number | string[]): string {
    if (Array.isArray(value)) {
      return JSON.stringify(value.sort());
    }
    return String(value);
  }

  /**
   * Calculate overall confidence based on consensus ratio
   */
  private calculateConfidence(): number {
    const totalFields =
      Object.keys(this.consensus).length +
      Object.keys(this.conflicts).length +
      Object.keys(this.missing).length;

    if (totalFields === 0) {
      return 0.0;
    }

    // Weight: consensus = 100%, conflicts = 30%, missing = 0%
    const score =
      (Object.keys(this.consensus).length * 1.0 +
        Object.keys(this.conflicts).length * 0.3) /
      totalFields;

    return Math.round(score * 1000) / 10; // Round to 1 decimal
  }

  /**
   * Get list of fields that need manual review
   */
  private getReviewItems(): string[] {
    const review: string[] = [];

    for (const field of Object.keys(this.conflicts)) {
      review.push(`Review ${field}: Models disagree`);
    }

    for (const field of Object.keys(this.missing)) {
      review.push(`Review ${field}: Missing from all models`);
    }

    return review;
  }
}

/**
 * Log consensus report (for debugging)
 */
export function logConsensusReport(
  _results: Record<string, InvoiceData | null>,
  analysis: ConsensusAnalysis
): void {
  logger.info('='.repeat(80));
  logger.info('CONSENSUS REPORT');
  logger.info('='.repeat(80));

  logger.info(
    { count: Object.keys(analysis.consensus).length },
    'FIELDS WITH CONSENSUS'
  );
  for (const [field, value] of Object.entries(analysis.consensus)) {
    logger.info({ field, value }, 'Consensus field');
  }

  if (Object.keys(analysis.conflicts).length > 0) {
    logger.warn(
      { count: Object.keys(analysis.conflicts).length },
      'FIELDS WITH CONFLICTS'
    );
    for (const [field, values] of Object.entries(analysis.conflicts)) {
      logger.warn({ field, values }, 'Conflict field');
    }
  }

  if (Object.keys(analysis.missing).length > 0) {
    logger.warn(
      { count: Object.keys(analysis.missing).length },
      'MISSING FIELDS'
    );
    for (const [field, info] of Object.entries(analysis.missing)) {
      logger.warn({ field, info }, 'Missing field');
    }
  }

  logger.info(
    { confidenceScore: analysis.confidence_score },
    'Overall Confidence Score'
  );

  if (analysis.confidence_score >= 80) {
    logger.info('HIGH CONFIDENCE - Data appears reliable, minimal review needed');
  } else if (analysis.confidence_score >= 50) {
    logger.warn('MEDIUM CONFIDENCE - Review conflicts manually before using');
  } else {
    logger.error('LOW CONFIDENCE - Extensive manual review required');
  }
}
