export const requireAuth = (req, res, next) => {
    // Mengecualikan endpoint root '/' untuk cek status server
    if (req.path === '/' && req.method === 'GET') {
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            status: "error",
            message: "Unauthorized: Akses ditolak, token tidak valid."
        });
    }

    const token = authHeader.split(' ')[1];

    if (token !== process.env.API_SECRET_TOKEN) {
        return res.status(401).json({
            status: "error",
            message: "Unauthorized: Akses ditolak, token tidak valid."
        });
    }

    next();
};
