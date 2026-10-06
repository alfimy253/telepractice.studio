import express from 'express';
import app from './api/index.js';

const port = Number(process.env.PORT || 3000);
app.use(express.static(process.cwd(), { dotfiles: 'ignore', index: 'index.html', etag: true, maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.listen(port, '0.0.0.0', () => console.log(`Practice site listening on http://localhost:${port}`));
