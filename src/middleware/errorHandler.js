const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Validation errors
  if (err.type === 'validation') {
    return res.status(422).json({
      error: { code: 'VALIDATION_ERROR', message: err.message, fields: err.fields }
    });
  }

  // Duplicate key (idempotency)
  if (err.code === '23505') {
    return res.status(409).json({
      error: { code: 'DUPLICATE_REQUEST', message: 'This request was already processed.' }
    });
  }

  // Default 500
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' }
  });
};

module.exports = { errorHandler };
