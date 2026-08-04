"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate = validate;
function validate(schema) {
    return (req, res, next) => {
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
