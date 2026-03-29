# Invoice OCR Extraction Guide

## How Invoice Extraction Works

### Smart Fallback System

The invoice OCR system uses a **smart fallback approach** with confidence-based decision making:

```
1. Call DeepSeek (Primary Model)
   ↓
   Calculate confidence score
   ↓
   ≥90% confidence? → STOP ✅ Return result
   ↓
2. Call Mistral (First Fallback)
   ↓
   Recalculate consensus confidence with both models
   ↓
   ≥90% confidence? → STOP ✅ Return result
   ↓
3. Call Gemini (Second Fallback)
   ↓
   Calculate final consensus from all 3 models
   ↓
   Return result (regardless of confidence)
```

**Benefits:**
- ⚡ **Faster**: 10s if DeepSeek is confident (vs 30s for all 3 models)
- 💰 **Cheaper**: Only calls additional models when needed
- 🎯 **Smart**: Knows when to stop based on confidence threshold
- 🔄 **Reliable**: Always has backup models if primary fails

---

## Why Some Fields Are Missing

### 1. **Invoice Format Issues**

**Problem**: The invoice doesn't follow standard formatting

**Examples:**
- Handwritten invoices
- Scanned invoices with poor quality
- Non-standard layouts (e.g., creative designs)
- Multi-column invoices
- Invoices in non-Latin scripts

**Solution:**
- Use high-resolution PDFs when possible (300 DPI minimum)
- Avoid invoices with watermarks or overlays
- Request standard invoice format from vendors

---

### 2. **Field Not Present on Invoice**

**Problem**: The invoice doesn't contain the requested information

**Examples:**
| Field | Why It Might Be Missing |
|-------|------------------------|
| **Vendor** | Logo-only header, no text name |
| **Account Nr** | Some invoices only have "Invoice #" |
| **Document Type** | Not explicitly stated (assume "Invoice") |
| **VAT Percentage** | Older invoices, B2C invoices, non-EU |
| **Performance Period** | Only present on service invoices, not goods |
| **Due Date** | Missing on prepaid/COD invoices |
| **Booking Date** | This is YOUR internal date, not on invoice |

**Solution:**
- Manually fill in missing fields from your records
- Contact vendor for missing critical information
- Use defaults for optional fields (e.g., Document Type = "Standard Invoice")

---

### 3. **Model Confusion / Ambiguity**

**Problem**: Multiple similar values confuse the AI

**Examples:**

**Invoice #1:**
```
Invoice Number: INV-2025-001
Reference: REF-2025-001        ← AI might confuse this
Order Number: ORD-2025-001     ← AI might confuse this
```

**Invoice #2:**
```
Net Amount: 1,000.00 EUR
Subtotal: 950.00 EUR           ← AI might pick wrong one
Discount: 50.00 EUR
```

**Invoice #3:**
```
Invoice Date: 10.03.2025
Ship Date: 11.03.2025          ← AI might confuse with due date
Payment Due: 25.03.2025
```

**Solution:**
- Check the **Agreement Dot** (🔴🟡🟢) next to each field
- Green dot = all models agree ✅
- Yellow dot = some disagreement ⚠️
- Red dot = models disagree ❌
- Click the dot to see what each model extracted
- Choose the correct value manually if needed

---

### 4. **Language and Currency Issues**

**Problem**: Non-English invoices or unusual currency formats

**Examples:**
- European date format: `10.03.2025` vs `03/10/2025`
- Currency symbols: `1.000,50 €` vs `€1,000.50`
- Month names in German: `10. März 2025`
- Arabic numerals vs Indian numerals
- Right-to-left languages (Arabic, Hebrew)

**Current Support:**
- ✅ English, German, French, Spanish, Italian, Polish
- ✅ EUR, USD, GBP, CHF, PLN, CZK
- ✅ European and US date formats
- ⚠️ Limited support for other languages/currencies

**Solution:**
- System automatically normalizes dates and numbers
- Manually verify currency conversions
- Contact support if you need support for additional languages

---

### 5. **Low Image Quality**

**Problem**: PDF scan quality is too low for OCR

**Indicators:**
- Confidence score < 50%
- Most fields missing or incorrect
- Many red dots (model disagreement)

**Causes:**
- Low-resolution scans (< 200 DPI)
- Faded/photocopied invoices
- Photos taken with phone camera
- Heavy compression artifacts
- Skewed/rotated scans

**Solution:**
- Request original PDF from vendor
- Re-scan at higher resolution (300+ DPI)
- Use document scanner app with auto-straighten
- Avoid JPEG compression (use PNG or PDF)
- Check file size: Good quality = 100KB-2MB per page

---

## Understanding Confidence Scores

### Overall Confidence

| Score | Meaning | Action Required |
|-------|---------|----------------|
| **90-100%** | ✅ **Excellent** | Minimal review needed |
| **80-89%** | ✅ **Good** | Quick spot-check recommended |
| **70-79%** | ⚠️ **Medium** | Review yellow/red fields carefully |
| **50-69%** | ⚠️ **Low** | Manual verification required |
| **< 50%** | ❌ **Poor** | Re-upload or manual entry recommended |

### Field-Level Confidence

**How It's Calculated:**

1. **Model Agreement** (60% weight)
   - All 3 models agree → 100%
   - 2 models agree → 67%
   - All models disagree → 33%

2. **Field Validation** (40% weight)
   - Has meaningful value → +points
   - Passes format validation → +points
   - Critical field (vendor, amounts, dates) → higher weight

3. **Final Score** = (Agreement × 0.6) + (Validation × 0.4)

**Example:**

```
Field: Net Amount

DeepSeek:  €1,000.50
Mistral:   €1,000.50
Gemini:    €1,000.50

Agreement: 100% (all agree)
Validation: 100% (valid number, critical field)
Confidence: (1.0 × 0.6) + (1.0 × 0.4) = 100%
```

vs

```
Field: Performance Period Start

DeepSeek:  01.03.2025
Mistral:   10.03.2025
Gemini:    (not found)

Agreement: 33% (all different)
Validation: 66% (has date, but not critical)
Confidence: (0.33 × 0.6) + (0.66 × 0.4) = 46%
```

---

## Critical vs Optional Fields

### Critical Fields (Required for Processing)

These fields **must** be present and accurate:

- ✅ **Vendor** - Who issued the invoice
- ✅ **Account/Invoice Number** - Unique identifier
- ✅ **Net Amount** - Pre-tax amount
- ✅ **Gross Amount** - Total amount including VAT
- ✅ **Currency** - EUR, USD, etc.
- ✅ **Issued Date** - When invoice was created

### Optional Fields (Nice to Have)

These can be filled manually if missing:

- ⭕ **Document Type** - Usually "Standard Invoice"
- ⭕ **VAT Amount** - Can be calculated: Gross - Net
- ⭕ **VAT Percentage** - Can be calculated: VAT / Net × 100
- ⭕ **Due Date** - Can use default payment terms
- ⭕ **Performance Period** - Only for service invoices
- ⭕ **Booking Date** - Your internal accounting date

---

## Common Extraction Issues & Solutions

### Issue 1: Vendor Not Recognized

**Symptoms:**
- Vendor field is empty or shows "-"
- Red agreement dot

**Causes:**
- Vendor name only in logo (no text)
- Multiple company names on invoice
- Vendor name is very long or abbreviated

**Solutions:**
1. Look for vendor name in invoice header
2. Check agreement dot - click to see what models found
3. Manually select from dropdown or type vendor name
4. Add vendor to known logistics vendors list

---

### Issue 2: Wrong Amount Extracted

**Symptoms:**
- Amount seems too high or too low
- Yellow/red agreement dot
- Amount doesn't match PDF

**Causes:**
- Multiple amounts on invoice (subtotal, discount, shipping, total)
- Currency confusion (1,000.50 vs 1.000,50)
- OCR misreading: 0 as O, 1 as l, 5 as S

**Solutions:**
1. **Click the agreement dot** - see what each model extracted
2. Verify which amount is correct by looking at PDF
3. Check invoice structure:
   ```
   Subtotal:     €950.00
   Shipping:     € 50.00
   Net Amount:   €1,000.00  ← Should be this
   VAT (19%):    € 190.00
   Total:        €1,190.00  ← Not this
   ```
4. Manually correct if needed

---

### Issue 3: Date Format Confusion

**Symptoms:**
- Date shows wrong day/month
- Multiple dates extracted
- Date validation error

**Causes:**
- US vs EU date format: 03/10/2025 could be March 10 or October 3
- Multiple dates: Invoice date, ship date, due date, period dates

**Solutions:**
1. System tries to auto-detect format from invoice language/currency
2. Check agreement dot to see what models found
3. Manually correct using date picker (always saves as YYYY-MM-DD)
4. Look at PDF to confirm correct date

---

### Issue 4: Performance Period Missing

**Symptoms:**
- Performance Period fields show "-"
- Low confidence score

**Causes:**
- **This is NORMAL for most invoices**
- Performance period is only relevant for:
  - Service contracts (monthly fees, subscriptions)
  - Rental agreements
  - Usage-based billing (utilities, telecom)

**For product invoices (goods), this field is usually empty**

**Solutions:**
- If it's a product invoice: Leave empty (use "-")
- If it's a service invoice and missing: Check invoice for date range
- Common locations:
  - "Service period: 01.03.2025 - 31.03.2025"
  - "Reporting period: March 2025"
  - "Billing cycle: 2025-03"

---

### Issue 5: Multiple Invoices Look Similar

**Symptoms:**
- Duplicate invoice number error
- System says "Invoice already exists"

**Causes:**
- Same vendor sends similar-looking invoices
- Invoice numbers are sequential or similar
- Accidentally uploaded same file twice

**Solutions:**
1. Check if this is actually a duplicate
2. Look for differences:
   - Invoice number (might differ by one digit)
   - Date
   - Amount
3. If it's truly a duplicate: Delete and don't reupload
4. If it's different: Change invoice number to make it unique

---

## Best Practices

### ✅ DO:
- Upload original PDF files when possible
- Use 300 DPI or higher for scans
- Verify critical fields (vendor, amount, date)
- Check agreement dots before approving
- Add notes for unusual invoices
- Train vendors to use standard invoice format

### ❌ DON'T:
- Upload low-quality JPEGs or photos
- Approve invoices with <70% confidence without review
- Ignore red agreement dots
- Skip manual verification of amounts
- Upload encrypted or password-protected PDFs
- Edit PDF before upload (may reduce OCR accuracy)

---

## FAQ

**Q: Why does the system call multiple AI models?**

A: Multiple models provide consensus voting - if all 3 agree, we're very confident the extraction is correct. It's like having 3 independent reviewers verify each field.

**Q: Why does it sometimes only call 1 or 2 models instead of all 3?**

A: Our smart fallback system stops calling models once confidence reaches 90%. This saves time and money while still ensuring accuracy.

**Q: What happens if all 3 models disagree?**

A: The system flags this as a conflict (red dot), and you'll need to manually verify which value is correct by checking the PDF.

**Q: Can I force it to use only one specific model?**

A: Currently no - the system is designed for consensus-based accuracy. However, you can see which model extracted which value by clicking the agreement dot.

**Q: Why is the confidence score low even though the data looks correct?**

A: Low confidence means the models disagreed or found the data ambiguous. Even if the final value looks correct, you should verify it against the PDF to be safe.

**Q: What if my invoice is in a language not supported?**

A: The system may still extract numbers and dates, but text fields (vendor, document type) will have low confidence. Manual entry is recommended.

**Q: Can I edit the extracted data?**

A: Yes! All fields are editable. Click into any field, make changes, and they're automatically saved. The agreement dot will disappear once you manually edit a field.

**Q: What's the difference between "Approved" and "Ready for approval"?**

A:
- **Ready for approval** (yellow) = Extracted but not reviewed/approved yet
- **Approved** (green) = Reviewed by human and marked as correct
- **On Hold** (orange) = Flagged for further investigation
- **Deleted** (red) = Marked as duplicate or invalid

---

## Getting Help

If you're experiencing consistent extraction issues:

1. **Check this guide** for common solutions
2. **Look at the backend logs** (`/tmp/backend-dev.log`) for detailed extraction info
3. **Share example invoices** that are failing (remove sensitive data first)
4. **Contact the development team** with:
   - Invoice ID
   - Which fields are failing
   - Expected vs actual values
   - PDF quality/format details

---

**Last Updated**: 2025-11-03
**Version**: 2.0 (Smart Fallback System)
