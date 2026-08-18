/**
 * Conversión Markdown → HTML compatible con el motor de Rich Content de Wix
 * Stores Catalog V3 (F8).
 *
 * El alta de productos V3 (`stores/v3/products-with-inventory`) espera la
 * descripción como Rich Content Document (RCD) `{ nodes: [...] }`, pero la vía
 * más ligera en Node/Railway (sin DOM ni el paquete Ricos) es enviar **HTML**
 * (generado con `marked` desde el Markdown de Gemini) y dejar que Wix convierta
 * a RCD nativamente.
 *
 * - `stripMarkdownFences()`: limpia los fences ` ``` ` que Gemini pudiera
 *   envolver alrededor del markdown.
 * - `convertMarkdownToWixHtml()`: Markdown → string HTML continuo (etiquetas
 *   simples: p, ul, ol, li, strong, em, h1-h6).
 * - `stripMarkdown()`: elimina la sintaxis markdown → texto plano (para JSON-LD
 *   / schema.org, que NO debe llevar markdown crudo).
 */
import { marked } from 'marked';

/** Limpia fences de código que Gemini pudiera envolver alrededor del markdown. */
export function stripMarkdownFences(text: string): string {
  return text.replace(/^\s*```[a-z]*\s*\n?/gi, '').replace(/\n?\s*```\s*$/gi, '').trim();
}

/** Convierte el Markdown de Gemini a un string HTML compatible con el motor de
 * Rich Content de Wix Stores V3 (etiquetas simples: p, ul, ol, li, strong, em, h1-h6). */
export function convertMarkdownToWixHtml(markdownText: string): string {
  const clean = stripMarkdownFences(markdownText ?? '');
  if (!clean) return '';
  marked.setOptions({ gfm: true, breaks: true });
  const rawHtml = marked.parse(clean) as string;
  // Wix prefiere un string continuo sin saltos de línea de código.
  return rawHtml.replace(/\r?\n|\r/g, '').trim();
}

/** Elimina la sintaxis markdown (para JSON-LD / texto plano de SEO). */
export function stripMarkdown(text: string): string {
  return stripMarkdownFences(text ?? '')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
