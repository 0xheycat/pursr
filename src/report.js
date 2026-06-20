// pursor - PDF report generator.
//
// Renders a sweep summary into a styled, self-contained PDF report.
// Embeds each capture (PNG) inline so the report can be emailed/shared
// without any external assets.
//
// CLI:
//   pursr report --sweep ./out/sweep-xxx/sweep.json --out ./out/report.pdf
//   pursr sweep plan.json   # writes sweep.json + .html; PDF generated separately
//
// Library:
//   import { renderSweepPdf } from "pursr/report";
//   const bytes = await renderSweepPdf(summary, { out: "report.pdf" });

import PDFDocument from "pdfkit";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { writeFile } from "node:fs/promises";
import { escapeHtml } from "./util.js";

// A4 in points (1pt = 1/72 in)
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

/**
 * Render a sweep summary as a PDF.
 *
 * @param {object} summary       - Sweep summary from runSweep()
 * @param {object} [opts]
 * @param {string} [opts.out]    - Output PDF file path
 * @param {string} [opts.title]  - Report title (defaults to sweep.name)
 * @param {string} [opts.subtitle] - Subtitle
 * @param {boolean} [opts.embedImages=true] - Embed each capture PNG inline
 * @returns {Promise<Buffer>}   - PDF bytes (also written to opts.out if set)
 */
export async function renderSweepPdf(summary, opts = {}) {
  if (!summary || !Array.isArray(summary.steps)) {
    throw new Error("renderSweepPdf: summary.steps must be an array");
  }
  const title = opts.title || `pursr sweep: ${summary.name || "(unnamed)"}`;
  const subtitle = opts.subtitle || `${summary.steps.length} steps · ${summary.ts || ""} · ${summary.outDir || ""}`;
  const embedImages = opts.embedImages !== false;

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: {
    Title: title,
    Author: "pursr",
    Subject: "Visual sweep report",
    CreationDate: new Date(),
  }});

  // Collect bytes
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ---- Header ----
  doc.fillColor("#0B0B0F").rect(0, 0, PAGE_W, 80).fill();
  doc.fillColor("#FF2EA6").fontSize(22).font("Helvetica-Bold").text("pursr", MARGIN, 30);
  doc.fillColor("#FFFFFF").fontSize(14).font("Helvetica").text(title, MARGIN + 70, 36);
  doc.fillColor("#A0A0AA").fontSize(9).text(subtitle, MARGIN + 70, 56);
  doc.moveDown(3);

  // ---- Summary stats ----
  const total = summary.steps.length;
  const passed = summary.steps.filter((s) => s.ok).length;
  const failed = total - passed;
  const totalMs = summary.steps.reduce((acc, s) => acc + (s.ms || 0), 0);

  doc.fillColor("#0B0B0F").font("Helvetica-Bold").fontSize(14).text("Summary", MARGIN, doc.y);
  doc.moveDown(0.5);
  const stats = [
    ["Steps", `${total}`],
    ["Passed", `${passed}`],
    ["Failed", `${failed}`],
    ["Total time", `${(totalMs / 1000).toFixed(1)}s`],
  ];
  drawStatGrid(doc, stats, MARGIN, doc.y, CONTENT_W);
  doc.moveDown(1.5);

  // ---- Per-step results ----
  for (let i = 0; i < summary.steps.length; i++) {
    const step = summary.steps[i];
    // Page break if less than 200pt left
    if (doc.y > PAGE_H - 200) doc.addPage();

    // Step header
    const status = step.ok ? "OK" : "FAIL";
    const statusColor = step.ok ? "#0a8a4a" : "#d03030";
    doc.fillColor("#0B0B0F").font("Helvetica-Bold").fontSize(12).text(`#${step.i} ${step.name || "step-" + step.i}`, MARGIN, doc.y);
    doc.fillColor(statusColor).font("Helvetica-Bold").fontSize(10).text(status, MARGIN + CONTENT_W - 40, doc.y - 12, { width: 40, align: "right" });
    doc.moveDown(0.3);
    doc.fillColor("#666").font("Helvetica").fontSize(9);
    const opLine = `${step.op || "?"} · ${step.ms || 0}ms${step.meta?.url ? " · " + step.meta.url : ""}`;
    doc.text(opLine, MARGIN, doc.y);
    doc.moveDown(0.3);

    // Embed image
    if (embedImages) {
      const img = step.meta?.out || (step.meta?.currentPath);
      if (img && existsSync(img)) {
        try {
          const maxW = CONTENT_W;
          const maxH = 280;
          doc.image(img, MARGIN, doc.y, { fit: [maxW, maxH], align: "center" });
          doc.moveDown(0.5);
          doc.y += 5;
        } catch (e) {
          doc.fillColor("#999").font("Helvetica-Oblique").fontSize(8).text(`[image error: ${e.message}]`, MARGIN, doc.y);
          doc.moveDown(0.5);
        }
      }
    }

    // Diffs / errors
    if (step.meta?.numDiff !== undefined) {
      doc.fillColor("#444").font("Helvetica").fontSize(9);
      const pct = step.meta.diffPct?.toFixed?.(3) ?? "?";
      doc.text(`Diff: ${step.meta.numDiff} pixels (${pct}%) differ from reference`, MARGIN, doc.y);
      doc.moveDown(0.3);
    }
    if (!step.ok && step.error) {
      doc.fillColor("#a01010").font("Helvetica").fontSize(9).text(`Error: ${step.error}`, MARGIN, doc.y);
      doc.moveDown(0.3);
    }
    if (step.meta?.har) {
      doc.fillColor("#666").font("Helvetica").fontSize(8).text(`HAR: ${step.meta.har}`, MARGIN, doc.y);
      doc.moveDown(0.3);
    }
    if (step.meta?.violations !== undefined) {
      const v = step.meta.violations || step.meta.violationSummary;
      const total = typeof v === "object" ? v.total : v;
      doc.fillColor("#444").font("Helvetica").fontSize(9).text(`Audit: ${total} violations`, MARGIN, doc.y);
      doc.moveDown(0.3);
    }

    doc.moveDown(0.8);
    // Separator
    doc.strokeColor("#e0e0e8").lineWidth(0.5).moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).stroke();
    doc.moveDown(0.5);
  }

  // ---- Footer ----
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor("#999").fontSize(8).font("Helvetica");
    doc.text(`${i + 1} / ${range.count}`, MARGIN, PAGE_H - 30, { width: CONTENT_W, align: "center" });
    doc.text("Generated by pursr", MARGIN, PAGE_H - 30, { width: CONTENT_W, align: "right" });
  }

  doc.end();
  const buf = await done;
  if (opts.out) {
    await writeFile(opts.out, buf);
  }
  return buf;
}

function drawStatGrid(doc, items, x, y, w) {
  const cols = items.length;
  const cellW = w / cols;
  for (let i = 0; i < cols; i++) {
    const [label, value] = items[i];
    const cx = x + cellW * i;
    doc.fillColor("#FF2EA6").font("Helvetica-Bold").fontSize(20).text(value, cx, y, { width: cellW - 8, align: "left" });
    doc.fillColor("#666").font("Helvetica").fontSize(8).text(label, cx, y + 24, { width: cellW - 8, align: "left" });
  }
  return y + 50;
}

export { renderSweepPdf as default };
