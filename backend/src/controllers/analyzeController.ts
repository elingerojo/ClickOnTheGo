/**
 * POST /api/analyze — envía las fotos + categoría a Gemini y devuelve
 * el JSON base integrado (producto + variantes) + JSON-LD + errores por campo.
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { analyzeProduct } from '../services/geminiService.js';

const analyzeSchema = z.object({
  imageUrls: z.array(z.string().min(1)).min(1, 'Se necesita al menos una foto').max(12),
  category: z.string().max(100).optional(),
});

export async function analyze(req: Request, res: Response): Promise<void> {
  const parsed = analyzeSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || '_root';
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    res.status(400).json({ error: 'Body inválido', fieldErrors });
    return;
  }
  try {
    const outcome = await analyzeProduct(parsed.data.imageUrls, parsed.data.category);
    res.json(outcome);
  } catch (err: any) {
    console.error('[analyze] Error analizando fotos:', err.message);
    res.status(502).json({ error: `Error analizando las fotos: ${err.message}` });
  }
}
