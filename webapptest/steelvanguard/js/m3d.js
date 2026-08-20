(function () {
  const M3D = {};
  const A = 34;
  const B = 17;
  const C = 38;
  M3D.A = A;
  M3D.B = B;
  M3D.C = C;
  M3D.VIEW = { x: -0.37, y: -0.37, z: 0.83 };
  M3D.LIGHT = { x: -0.45, y: -0.45, z: 0.77 };
  M3D.proj = (cam, x, y, z) => {
    if (z === undefined) z = 0;
    return [(x - y) * A * cam.s + cam.ox, (x + y) * B * cam.s - z * C * cam.s + cam.oy];
  };
  M3D.unproj = (cam, px, py, z) => {
    if (z === undefined) z = 0;
    const d1 = (px - cam.ox) / (A * cam.s);
    const d2 = (py - cam.oy + z * C * cam.s) / (B * cam.s);
    return [(d1 + d2) / 2, (d2 - d1) / 2];
  };
  M3D.depth = (x, y, z) => (x + y) - (z || 0) * 2.2;
  const FACES = [
    { n: [-1, 0, 0], v: [0, 3, 2, 1] },
    { n: [1, 0, 0], v: [1, 2, 6, 5] },
    { n: [0, -1, 0], v: [0, 1, 5, 4] },
    { n: [0, 1, 0], v: [3, 7, 6, 2] },
    { n: [0, 0, -1], v: [0, 1, 2, 3] },
    { n: [0, 0, 1], v: [4, 5, 6, 7] }
  ];
  M3D.drawBox = function (ctx, cam, cx, cy, cz, hx, hy, hz, rot, col, opts) {
    if (cz === undefined) cz = 0;
    if (rot === undefined) rot = 0;
    opts = opts || {};
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const ex = [
      [-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]
    ];
    const pts3 = [], pts2 = [];
    for (let k = 0; k < 4; k++) {
      const rx = ex[k][0] * ca - ex[k][1] * sa;
      const ry = ex[k][0] * sa + ex[k][1] * ca;
      pts3.push([cx + rx, cy + ry, cz - hz]);
      pts3.push([cx + rx, cy + ry, cz + hz]);
    }
    for (let k = 0; k < 8; k++) pts2.push(M3D.proj(cam, pts3[k][0], pts3[k][1], pts3[k][2]));
    const vis = [];
    for (let f = 0; f < FACES.length; f++) {
      const face = FACES[f];
      const nx = face.n[0] * ca - face.n[1] * sa;
      const ny = face.n[0] * sa + face.n[1] * ca;
      const nz = face.n[2];
      const d = nx * M3D.VIEW.x + ny * M3D.VIEW.y + nz * M3D.VIEW.z;
      if (d <= 0.001) continue;
      const l = Math.max(0, nx * M3D.LIGHT.x + ny * M3D.LIGHT.y + nz * M3D.LIGHT.z);
      let bright = 0.55 + 0.55 * l;
      if (opts.glow) bright = Math.min(1.8, bright + opts.glow);
      const cidx = face.v.slice();
      let sx = 0, sy = 0, sz = 0;
      for (let k = 0; k < 4; k++) {
        sx += pts3[cidx[k]][0];
        sy += pts3[cidx[k]][1];
        sz += pts3[cidx[k]][2];
      }
      vis.push({
        c: cidx,
        col: U.rgb([col[0] * bright, col[1] * bright, col[2] * bright]),
        key: M3D.depth(sx / 4, sy / 4, sz / 4)
      });
    }
    vis.sort((p, q) => q.key - p.key);
    for (let f = 0; f < vis.length; f++) {
      const fc = vis[f];
      ctx.beginPath();
      ctx.moveTo(pts2[fc.c[0]][0], pts2[fc.c[0]][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(pts2[fc.c[k]][0], pts2[fc.c[k]][1]);
      ctx.closePath();
      if (opts.alpha !== undefined) {
        const oldA = ctx.globalAlpha;
        ctx.globalAlpha = oldA * opts.alpha;
        ctx.fillStyle = fc.col;
        ctx.fill();
        ctx.globalAlpha = oldA;
      } else {
        ctx.fillStyle = fc.col;
        ctx.fill();
      }
      if (opts.edge) {
        ctx.strokeStyle = U.rgb(U.darken(col, 0.45));
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  };
  M3D.drawQuad = function (ctx, cam, pts, col, alpha, line) {
    ctx.beginPath();
    for (let k = 0; k < pts.length; k++) {
      const p = M3D.proj(cam, pts[k][0], pts[k][1], pts[k][2] || 0);
      if (k === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    if (alpha !== undefined) {
      const oldA = ctx.globalAlpha;
      ctx.globalAlpha = oldA * alpha;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = oldA;
    } else {
      ctx.fillStyle = col;
      ctx.fill();
    }
    if (line) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };
  M3D.drawShadow = function (ctx, cam, x, y, r) {
    const p1 = M3D.proj(cam, x - r, y - r, 0);
    const p2 = M3D.proj(cam, x + r, y - r, 0);
    const p3 = M3D.proj(cam, x + r, y + r, 0);
    const p4 = M3D.proj(cam, x - r, y + r, 0);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.lineTo(p4[0], p4[1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
  };
  M3D.diamond = function (ctx, cam, cx, cy, r, z, col, alpha) {
    const p1 = M3D.proj(cam, cx - r, cy - r, z || 0);
    const p2 = M3D.proj(cam, cx + r, cy - r, z || 0);
    const p3 = M3D.proj(cam, cx + r, cy + r, z || 0);
    const p4 = M3D.proj(cam, cx - r, cy + r, z || 0);
    ctx.beginPath();
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.lineTo(p4[0], p4[1]);
    ctx.closePath();
    if (alpha !== undefined) {
      const oldA = ctx.globalAlpha;
      ctx.globalAlpha = oldA * alpha;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = oldA;
    } else {
      ctx.fillStyle = col;
      ctx.fill();
    }
  };
  window.M3D = M3D;
})();
