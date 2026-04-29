export const errorHandler = (err, req, res, next) => {
    let statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    let message = err.message;

    // Services can opt into a precise status by setting `err.statusCode`
    // directly (instead of relying on the keyword heuristics below).
    // This is the preferred path for any new business-rule error —
    // `throw Object.assign(new Error('...'), { statusCode: 400 })`.
    if (typeof err.statusCode === 'number') {
        statusCode = err.statusCode;
    }

    // Mongoose bad ObjectId / cast errors
    if (err.name === 'CastError') {
        statusCode = 400;
        message = err.kind === 'ObjectId'
            ? `Invalid id format: ${err.value}`
            : `Invalid value for ${err.path}: ${err.value}`;
    }

    // Mongoose validation error
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = Object.values(err.errors).map(val => val.message).join(', ');
    }

    // MongoDB duplicate-key errors (e.g. duplicate email, duplicate
    // (user, organisation) membership, duplicate role name in org).
    if (err.code === 11000) {
        statusCode = 409;
        const fields = Object.keys(err.keyValue || {}).join(', ') || 'field';
        message = `Duplicate value for ${fields}`;
    }

    // Errors thrown via `throw new Error(...)` in services keep their
    // default 500 unless they're known business-rule errors. Map a few
    // common ones to 400/404 so the API surface is sensible.
    if (statusCode === 500 && err instanceof Error) {
        const m = err.message.toLowerCase();
        if (m.includes('not found')) statusCode = 404;
        else if (
            m.includes('required') ||
            m.includes('invalid') ||
            m.includes('already') ||
            m.includes('cannot') ||
            m.includes('inconsistent') ||
            m.includes('did not change') ||
            m.includes('must ')
        ) {
            statusCode = 400;
        }
    }

    const body = {
        success: false,
        error: message,
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    };
    // Optional structured payload for FE devs to inspect — e.g. the
    // observed sibling orders on a `Sibling order is inconsistent`
    // error so they can spot a swapped prev/next pair without
    // attaching a debugger.
    if (err.details && typeof err.details === 'object') {
        body.details = err.details;
    }

    res.status(statusCode).json(body);
};
