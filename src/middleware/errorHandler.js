export function notFoundHandler(req, res, next) {
	console.log(`[404] Route not found: ${req.method} ${req.path}`);
	res.status(404).json({ success: false, message: "Route not found" });
}

export function errorHandler(err, req, res, next) {
	// eslint-disable-next-line no-console
	console.error(err);
	const status = err.status || 500;
	res.status(status).json({ message: err.message || "Internal Server Error" });
}
