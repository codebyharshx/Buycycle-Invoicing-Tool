"use strict";
/**
 * Database Row Types
 *
 * These types represent the raw rows returned by MySQL/PostgreSQL queries
 * before transformation to application types.
 *
 * Key differences from application types:
 * - DECIMAL columns come back as strings
 * - TINYINT(1) comes back as 0 | 1 (not boolean)
 * - JSON columns come back as strings (need JSON.parse)
 * - DATETIME comes back as Date objects
 *
 * Note: These interfaces are compatible with mysql2's RowDataPacket
 * but don't extend it to avoid requiring mysql2 as a dependency.
 * Use type assertions when needed: rows as InvoiceExtractionRow[]
 */
Object.defineProperty(exports, "__esModule", { value: true });
// Note: BuyerProtectionClaim/ClaimRow types are defined in claims-pipeline.ts
//# sourceMappingURL=database-rows.js.map