export function createCloudHandler(service) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.searchParams.has('route')
      ? `/api/clouds/${url.searchParams.get('route')}`
      : url.pathname.replace(/\/$/, '');
    const json = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    try {
      if ((path === '/api/clouds' && req.method === 'GET') || (path === '/api/clouds/refresh' && req.method === 'POST')) {
        await service.refresh(req.method === 'POST');
        // Read the state after refresh() has cleared its in-flight guard.
        const snapshot = service.snapshot();
        const frame = snapshot.frame && { ...snapshot.frame,
          imageUrl: `${snapshot.frame.imageUrl}?observedAt=${encodeURIComponent(snapshot.frame.observedAt)}` };
        if (req.method === 'GET' && frame && !snapshot.error)
          res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=3600, stale-while-revalidate=3600');
        return json({ ...snapshot, frame });
      }
      const match = path.match(/^\/api\/clouds\/images\/(clouds-[a-f0-9]{20}\.png)$/);
      if (match && req.method === 'GET') {
        const png = await service.image(match[1], url.searchParams.get('observedAt'));
        if (!png) return json({ error: '云图不存在或观测时间无效' }, 404);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable',
          'Vercel-CDN-Cache-Control': 'public, max-age=31536000', 'X-Content-Type-Options': 'nosniff' });
        return res.end(png);
      }
      return json({ error: '未找到云图接口' }, 404);
    } catch { return json({ error: '卫星云图暂不可用，请稍后重试' }, 503); }
  };
}
