import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((e) => e.message)
        .join(', ');
      res.status(400).json({ error: message, code: 'VALIDATION_ERROR' });
      return;
    }
    req.body = result.data;
    next();
  };
}
