/* Clash Board 3D: realistic board, pieces (King, General, Major, Captain/Castle, Soldier), shadows, reflections, animations. */
var Board3D = (() => {
  const TOPY = 0.36; // top of the board squares
  let R, S, CAM, CTL, dom, RO, mk, cur = null, pieces = {}, prev = {}, failed = false, inited = false, tray = { w: [], b: [] }, actors = {}, queue = [], curJob = null, idleAt = 0, settled = true;
  const GC = {}, MAT = {}, ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOPY);
  const hw = r => Math.min(5, 2 + Math.min(r, 8 - r));

  /* ---------- procedural textures ---------- */
  function woodTex(base, grain, seed, rep) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d'); x.fillStyle = base; x.fillRect(0, 0, 256, 256);
    let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 110; i++) {
      const y = rnd() * 256, a = 0.04 + rnd() * 0.13; x.strokeStyle = `rgba(${grain},${a})`; x.lineWidth = 0.5 + rnd() * 2.4; x.beginPath(); x.moveTo(0, y);
      for (let px = 0; px <= 256; px += 16) x.lineTo(px, y + Math.sin(px * 0.03 + i) * 3 * rnd()); x.stroke();
    }
    const d = x.getImageData(0, 0, 256, 256);
    for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 9; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
    x.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep || 1, rep || 1); return t;
  }
  function gradTex(stops) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 512; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 512);
    stops.forEach(([p, col]) => g.addColorStop(p, col)); x.fillStyle = g; x.fillRect(0, 0, 4, 512);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }
  function labelTex(txt) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.font = 'bold 40px Georgia,serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#d9b86a'; x.fillText(txt, 32, 34);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
  }

  /* ---------- geometry helpers ---------- */
  function rbox(w, h, d, b = 0.022) { // rounded, bevelled box (base at y=0)
    const k = 'b' + w + '_' + h + '_' + d; if (GC[k]) return GC[k];
    const sw = w - 2 * b, sd = d - 2 * b, r = Math.min(0.05, sw / 2 - 0.001), x = -sw / 2, y = -sd / 2, s = new THREE.Shape();
    s.moveTo(x + r, y); s.lineTo(x + sw - r, y); s.quadraticCurveTo(x + sw, y, x + sw, y + r); s.lineTo(x + sw, y + sd - r);
    s.quadraticCurveTo(x + sw, y + sd, x + sw - r, y + sd); s.lineTo(x + r, y + sd); s.quadraticCurveTo(x, y + sd, x, y + sd - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 5 });
    g.rotateX(-Math.PI / 2); g.translate(0, b, 0); return (GC[k] = g);
  }
  function disc(r, h, b = 0.025) { // round disc with rounded edges (base at y=0)
    const k = 'd' + r + '_' + h; if (GC[k]) return GC[k]; const p = [new THREE.Vector2(0, 0), new THREE.Vector2(r - b, 0)];
    for (let i = 1; i <= 4; i++) { const a = i / 4 * Math.PI / 2; p.push(new THREE.Vector2(r - b + Math.sin(a) * b, b - Math.cos(a) * b)); }
    for (let i = 1; i <= 4; i++) { const a = i / 4 * Math.PI / 2; p.push(new THREE.Vector2(r - b + Math.cos(a) * b, h - b + Math.sin(a) * b)); }
    p.push(new THREE.Vector2(0, h)); return (GC[k] = new THREE.LatheGeometry(p, 48));
  }
  function stairOutline(m) { // board outline (rank coordinates), offset outward by m
    const L = r => -hw(r) - 0.5, Rt = r => hw(r) + 0.5, P = [[L(0), -0.5], [Rt(0), -0.5]];
    for (let r = 0; r < 9; r++) { P.push([Rt(r), r + 0.5]); if (r < 8) P.push([Rt(r + 1), r + 0.5]); }
    P.push([L(8), 8.5]); for (let r = 8; r >= 1; r--) { P.push([L(r), r - 0.5]); P.push([L(r - 1), r - 0.5]); }
    const Q = []; P.forEach((p, i) => { const q = P[(i + 1) % P.length]; if (!Q.length || Q[Q.length - 1][0] !== p[0] || Q[Q.length - 1][1] !== p[1]) Q.push(p); });
    const U = Q.filter((p, i) => { const a = Q[(i + Q.length - 1) % Q.length], b = Q[(i + 1) % Q.length]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); });
    const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; };
    return U.map((p, i) => { const a = U[(i + U.length - 1) % U.length], b = U[(i + 1) % U.length], n1 = nrm(a, p), n2 = nrm(p, b); return [p[0] + (n1[0] + n2[0]) * m, p[1] + (n1[1] + n2[1]) * m]; });
  }
  function slab(m, h, bevel, mat) {
    const pts = stairOutline(m), s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
    g.rotateX(-Math.PI / 2); g.translate(0, bevel, 4); const o = new THREE.Mesh(g, mat); o.castShadow = o.receiveShadow = true; return o;
  }

  /* ---------- scene ---------- */
  function env() {
    const e = new THREE.Scene(), sk = new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
    const p = sk.geometry.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) { const t = (p.getY(i) / 20 + 1) / 2, c = new THREE.Color().setHSL(0.6, 0.25, 0.07 + t * 0.35); col.push(c.r, c.g, c.b); }
    sk.geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); e.add(sk);
    const panel = (w, h, x, y, z, i) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); e.add(m); };
    panel(10, 6, -8, 12, 8, 6); panel(6, 10, 12, 6, 2, 3); panel(12, 3, 0, 14, -6, 4);
    const pm = new THREE.PMREMGenerator(R); S.environment = pm.fromScene(e, 0.03).texture; pm.dispose();
  }
  function materials() {
    MAT.w = new THREE.MeshPhysicalMaterial({ color: 0xe9eef7, roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.25 });
    MAT.b = new THREE.MeshPhysicalMaterial({ color: 0x1b1d24, roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 });
    MAT.gold = new THREE.MeshStandardMaterial({ color: 0xf5b700, roughness: 0.22, metalness: 1 });
    const wood = (base, grain, seed, rep, rough) => { const t = woodTex(base, grain, seed, rep); return new THREE.MeshPhysicalMaterial({ map: t, bumpMap: t, bumpScale: 0.6, roughness: rough, clearcoat: 0.35, clearcoatRoughness: 0.4 }); };
    MAT.light = wood('#e8cfa3', '120,80,40', 11, 1, 0.5); MAT.dark = wood('#7a4a2b', '30,15,5', 23, 1, 0.5);
    MAT.frame = wood('#4a2c17', '20,10,4', 37, 3, 0.45); MAT.table = wood('#3a2415', '12,6,2', 41, 0.35, 0.55);
    MAT.felt = new THREE.MeshStandardMaterial({ color: 0x1f3b2f, roughness: 0.95 }); MAT.floor = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.95 });
  }
  function buildBoard() {
    const fl = new THREE.Mesh(new THREE.CircleGeometry(70, 48).rotateX(-Math.PI / 2), MAT.floor); fl.position.y = FLOORY; fl.receiveShadow = true; S.add(fl);
    const top = new THREE.Mesh(rbox(21, 0.5, 14.6, 0.04), MAT.table); top.position.y = -0.5; top.castShadow = top.receiveShadow = true; S.add(top);
    [[-9.6, -6.4], [9.6, -6.4], [-9.6, 6.4], [9.6, 6.4]].forEach(([x, z]) => { const l = new THREE.Mesh(rbox(0.9, 8.5, 0.9, 0.04), MAT.frame); l.position.set(x, FLOORY, z); l.castShadow = true; S.add(l); });
    [1, -1].forEach(sg => { const t = new THREE.Mesh(rbox(4.6, 0.06, 8.6, 0.01), MAT.felt); t.position.set(sg * 8.35, 0, sg * 0.6); t.receiveShadow = true; S.add(t); });
    S.add(slab(0.62, 0.3, 0.05, MAT.frame));
    S.add(slab(0.1, 0.32, 0.01, new THREE.MeshStandardMaterial({ color: 0x1d120a, roughness: 0.7 })));
    for (let r = 0; r < 9; r++) for (let c = 0; c < 11; c++) {
      if (!ok(c, r)) continue;
      const g = new THREE.BoxGeometry(0.985, 0.06, 0.985), uv = g.attributes.uv, ox = Math.random(), oy = Math.random();
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + ox * 0.5, uv.getY(i) * 0.5 + oy * 0.5);
      const m = new THREE.Mesh(g, (c + r) % 2 ? MAT.dark : MAT.light); m.position.set(c - 5, TOPY - 0.03, 4 - r); m.receiveShadow = true; S.add(m);
    }
    const lab = (t, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: labelTex(t), transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.312, z); S.add(m); };
    for (let c = 0; c < 11; c++) { let r0 = 0; while (!ok(c, r0)) r0++; lab('abcdefghijk'[c], c - 5, 4 - r0 + 0.86); }
    for (let r = 0; r < 9; r++) lab(String(r + 1), -hw(r) - 0.86, 4 - r);
    mk = new THREE.Group(); S.add(mk);
  }

  /* ---------- pieces (shapes from the reference screenshots) ---------- */
  const HGT = { K: 1.94, G: 1.52, M: 1.5, C: 1.14, S: 0.78 };
  function buildPiece(t, col) {
    const g = new THREE.Group(), m = col === 'w' ? MAT.w : MAT.b;
    const add = (geo, y, mat, x = 0, z = 0) => { const o = new THREE.Mesh(geo, mat || m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    if (t === 'K') {
      add(rbox(0.84, 0.1, 0.84), 0); add(rbox(0.6, 0.9, 0.6), 0.1); add(rbox(0.4, 0.72, 0.4), 1.0);
      [1.1, 1.32, 1.54].forEach(y => add(rbox(0.62, 0.1, 0.62), y));
      add(rbox(0.62, 0.16, 0.62), 1.64, MAT.gold);
      [[-.27, -.27], [0, -.27], [.27, -.27], [.27, 0], [.27, .27], [0, .27], [-.27, .27], [-.27, 0]].forEach(([x, z]) => add(rbox(0.09, 0.14, 0.09, 0.012), 1.8, MAT.gold, x, z));
    } else if (t === 'G') {
      add(rbox(0.84, 0.1, 0.84), 0); add(rbox(0.6, 0.8, 0.6), 0.1); add(rbox(0.4, 0.62, 0.4), 0.9);
      add(rbox(0.62, 0.12, 0.62), 1.05); add(rbox(0.62, 0.12, 0.62), 1.4);
    } else if (t === 'S') {
      add(rbox(0.7, 0.08, 0.7), 0); add(rbox(0.46, 0.5, 0.46), 0.08); add(rbox(0.3, 0.16, 0.3), 0.58); add(rbox(0.5, 0.08, 0.5), 0.7);
    } else if (t === 'C') {
      add(disc(0.42, 0.08), 0); add(rbox(0.5, 0.72, 0.5), 0.08); add(disc(0.2, 0.34, 0.01), 0.8); add(disc(0.29, 0.12), 0.86); add(disc(0.29, 0.12), 1.02);
    } else {
      add(disc(0.42, 0.08), 0); add(rbox(0.52, 0.82, 0.52), 0.08); add(disc(0.2, 0.6, 0.01), 0.9);
      [0.96, 1.15, 1.34].forEach(y => add(disc(0.29, 0.12), y));
    }
    g.userData = { lift: 0, tl: 0, arcY: 0, hold: false, isPiece: true, h: HGT[t] || 1.4, col, t }; return g;
  }
  const V3 = THREE.Vector3, UPV = new V3(0, 1, 0), UA = 4.8, FA = 4.8, SEATZ = 8.5, SEATY = -3.6, FLOORY = -9, TRAYY = 0.06;
  const wp = (c, r) => ({ x: c - 5, z: 4 - r }), keyOf = (c, r) => c + ',' + r, kc = k => k.split(',').map(Number);
  const sqPos = k => { const [c, r] = kc(k), p = wp(c, r); return { x: p.x, z: p.z, y: TOPY, s: 1 }; };
  const trayPos = (col, i) => { const sg = col === 'b' ? 1 : -1; return { x: sg * (7.2 + (i % 3) * 1.15), z: sg * (4.4 - Math.floor(i / 3) * 0.95), y: TRAYY, s: 0.8 }; };
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, back = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
  function place(k, sig, scale) {
    const p = sqPos(k), g = buildPiece(sig[1], sig[0]); g.position.set(p.x, TOPY, p.z); g.userData.key = k;
    if (scale !== undefined) g.scale.setScalar(scale); S.add(g); pieces[k] = g; return g;
  }

  /* ---------- seated characters ---------- */
  function limb(mesh, P, Q) { const d = Q.clone().sub(P), L = d.length() || 1e-6; mesh.position.copy(P).addScaledVector(d, 0.5); mesh.quaternion.setFromUnitVectors(UPV, d.divideScalar(L)); mesh.scale.set(1, L, 1); }
  function solve(Sh, T, pole, a, b) {
    const d = T.clone().sub(Sh), L = d.length() || 1e-6, dir = d.clone().divideScalar(L), dc = Math.min(L, a + b - 0.02);
    const x = (a * a - b * b + dc * dc) / (2 * dc), h = Math.sqrt(Math.max(0, a * a - x * x)), p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (p.lengthSq() < 1e-6) p.set(0, -1, 0); p.normalize();
    return { E: Sh.clone().addScaledVector(dir, x).addScaledVector(p, h), P: Sh.clone().addScaledVector(dir, dc), short: Math.max(0, L - (a + b - 0.02)) };
  }
  function person(col) {
    const sgn = col === 'w' ? 1 : -1, root = new THREE.Group(); root.position.set(0, SEATY, sgn * SEATZ); root.rotation.y = col === 'w' ? 0 : Math.PI;
    const body = new THREE.Group(); root.add(body);
    const M = (c, r = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
    const mt = { skin: M(0xe2b596, 0.55), shirt: M(col === 'w' ? 0xf0f2f7 : 0x2a2e38, 0.7), pants: M(col === 'w' ? 0x3b4a6b : 0x15161a, 0.8), hair: M(col === 'w' ? 0x6b4a2b : 0x14100d, 0.6), shoe: M(0x0e0e10, 0.5), eye: M(0x101010, 0.3), lip: M(0x9a4a4a, 0.6), wood: MAT.frame };
    const add = (par, geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = o.receiveShadow = true; par.add(o); return o; };
    add(body, rbox(5.6, 0.5, 5.4), mt.wood, 0, -0.5, 0.3); add(body, rbox(5.6, 6.8, 0.5), mt.wood, 0, 0, 3.0);
    [[-2.5, -1.8], [2.5, -1.8], [-2.5, 2.7], [2.5, 2.7]].forEach(([x, z]) => add(body, rbox(0.5, 4.9, 0.5), mt.wood, x, -5.4, z));
    [-1, 1].forEach(s => { add(body, rbox(1.6, 1.4, 4.8), mt.pants, s * 1.1, 0, -2.4); add(body, rbox(1.4, 5.2, 1.4), mt.pants, s * 1.1, -5.0, -4.5); add(body, rbox(1.5, 0.5, 2.4), mt.shoe, s * 1.1, -5.4, -5.0); });
    add(body, rbox(4.2, 1.5, 3.0), mt.pants, 0, 0, 0);
    const up = new THREE.Group(); up.position.set(0, 1.3, 0); body.add(up);
    add(up, rbox(5.4, 6.0, 3.0), mt.shirt, 0, 0, 0);
    add(up, new THREE.CylinderGeometry(0.6, 0.65, 1.0, 16), mt.skin, 0, 5.9, 0);
    add(up, new THREE.SphereGeometry(1.75, 32, 24), mt.skin, 0, 8.1, 0, 0.95, 1.1, 1);
    add(up, new THREE.SphereGeometry(1.82, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.52), mt.hair, 0, 8.25, 0.12, 0.97, 1.12, 1.04);
    [-1, 1].forEach(s => { add(up, new THREE.SphereGeometry(0.19, 12, 8), mt.eye, s * 0.62, 8.25, -1.62); add(up, rbox(0.7, 0.1, 0.12, 0.01), mt.hair, s * 0.62, 8.7, -1.66); add(up, new THREE.SphereGeometry(0.33, 12, 8), mt.skin, s * 1.68, 8.0, 0.1); add(up, new THREE.SphereGeometry(1.0, 16, 12), mt.shirt, s * 2.95, 5.1, 0); });
    add(up, new THREE.SphereGeometry(0.25, 12, 8), mt.skin, 0, 7.8, -1.78); add(up, rbox(0.8, 0.1, 0.1, 0.01), mt.lip, 0, 7.15, -1.66);
    const arms = {}, restR = new V3(sgn * 3.0, 0.55, sgn * 6.0), restL = new V3(-sgn * 3.0, 0.55, sgn * 6.0);
    ['R', 'L'].forEach(sd => {
      const grp = new THREE.Group(), cyl = (r1, r2, mat) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, 1, 16), mat); o.castShadow = true; grp.add(o); return o; }, ball = (r, mat) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat); o.castShadow = true; grp.add(o); return o; };
      const upper = cyl(0.68, 0.58, mt.shirt), fore = cyl(0.52, 0.42, mt.skin), sh = ball(0.98, mt.shirt), el = ball(0.6, mt.skin), hand = new THREE.Group();
      const palm = add(hand, new THREE.SphereGeometry(0.5, 16, 12), mt.skin, 0, 0, 0, 1, 0.5, 1.1);
      [-0.33, -0.11, 0.11, 0.33].forEach(x => { const f = add(hand, new THREE.CapsuleGeometry(0.12, 0.42, 4, 8), mt.skin, x, -0.05, -0.72); f.rotation.x = Math.PI / 2; });
      add(hand, new THREE.CapsuleGeometry(0.14, 0.3, 4, 8), mt.skin, (sd === 'R' ? -1 : 1) * 0.5, -0.05, -0.2);
      grp.add(hand); S.add(grp); arms[sd] = { grp, upper, fore, sh, el, hand };
    });
    S.add(root);
    return { col, sgn, root, body, up, arms, restR, restL, hand: restR.clone(), lean: { p: 0, y: 0 }, active: false };
  }
  function pose(a, snap, now) {
    const rl = a.root, H = a.hand; rl.updateMatrixWorld(true);
    const Hl = rl.worldToLocal(H.clone()), f = -Hl.z, dh = Math.hypot(Hl.x - 2.95, Hl.z), need = THREE.MathUtils.clamp(dh - 6.4, 0, 4.8);
    const tp = Math.asin(Math.min(0.98, need / 5.2)), ty = THREE.MathUtils.clamp(-Math.atan2(Hl.x - 1.0, Math.max(1, f)) * 0.75, -0.9, 0.9);
    if (snap) { a.lean.p = tp; a.lean.y = ty; } else { a.lean.p += (tp - a.lean.p) * 0.14; a.lean.y += (ty - a.lean.y) * 0.14; }
    a.up.rotation.set(-a.lean.p, a.lean.y, 0, 'YXZ'); a.up.position.y = 1.3 + (now ? Math.sin(now / 900 + a.sgn) * 0.04 : 0); rl.updateMatrixWorld(true);
    let worst = 0;
    ['R', 'L'].forEach(sd => {
      const arm = a.arms[sd], s = sd === 'R' ? 1 : -1, Sh = a.up.localToWorld(new V3(s * 2.95, 5.1, 0)), T = sd === 'R' ? H : a.restL;
      const pole = new V3(s * 1.0, -0.9, 0.35).applyQuaternion(rl.quaternion), r = solve(Sh, T, pole, UA, FA); worst = Math.max(worst, r.short);
      limb(arm.upper, Sh, r.E); limb(arm.fore, r.E, r.P); arm.sh.position.copy(Sh); arm.el.position.copy(r.E); arm.hand.position.copy(r.P);
      const dx = T.x - Sh.x, dz = T.z - Sh.z; if (Math.hypot(dx, dz) > 0.01) arm.hand.rotation.y = Math.atan2(-dx, -dz);
    });
    if (CAM) { const behind = a.sgn * CAM.position.z > 6.5; a.body.visible = !behind; a.arms.L.grp.visible = !behind; a.arms.R.grp.visible = !behind || a.active; }
    return worst;
  }

  /* ---------- animation jobs: the character reaches, grabs, carries and places pieces ---------- */
  const SP = () => (api.fast ? 0.45 : 1), seg = (d, f, o) => Object.assign({ d: d * SP(), f, ease }, o);
  const gy = o => o.userData.h * 0.95 + 0.45, grip = (o, p, l) => new V3(p.x, p.y + gy(o) * p.s + l, p.z);
  const lerpHand = (a, A, B, u, arc) => { a.hand.lerpVectors(A, B, u); if (arc) a.hand.y += Math.sin(Math.PI * u) * arc; };
  function carryJob(o, A, B, col, arc) {
    const a = actors[col], f = new V3(), hold = () => o.position.set(a.hand.x, a.hand.y - gy(o) * o.scale.x, a.hand.z);
    const above = grip(o, A, 1.6), grab = grip(o, A, 0), lift = grip(o, A, 0.55), dropL = grip(o, B, 0.55), drop = grip(o, B, 0), up2 = grip(o, B, 1.2), dist = Math.hypot(B.x - A.x, B.z - A.z);
    return { actor: col, segs: [
      seg(420, u => lerpHand(a, f, above, u), { begin() { f.copy(a.hand); } }),
      seg(170, u => lerpHand(a, above, grab, u)),
      seg(160, u => { lerpHand(a, grab, lift, u); hold(); }, { begin() { o.userData.hold = true; o.userData.lift = 0; o.userData.arcY = 0; } }),
      seg(380 + 95 * dist, u => { lerpHand(a, lift, dropL, u, arc); o.scale.setScalar(A.s + (B.s - A.s) * u); hold(); }),
      seg(170, u => { lerpHand(a, dropL, drop, u); hold(); }),
      seg(130, u => lerpHand(a, drop, up2, u), { begin() { o.userData.hold = false; o.position.set(B.x, B.y, B.z); o.scale.setScalar(B.s); } })] };
  }
  const retractJob = a => { const f = new V3(); return { actor: a.col, retract: true, segs: [seg(420, u => lerpHand(a, f, a.restR, u), { begin() { f.copy(a.hand); } })] }; };
  const poofJob = o => ({ actor: null, segs: [seg(320, u => o.scale.setScalar(Math.max(0.001, 1 - u)), { end() { S.remove(o); } })] });
  const spawnJob = o => ({ actor: null, segs: [seg(450, u => o.scale.setScalar(Math.max(0.001, back(u))), { end() { o.scale.setScalar(1); } })] });
  function trayAlloc(col, o, t) { let i = tray[col].findIndex(e => !e); if (i < 0) i = tray[col].length; tray[col][i] = { o, t }; return i; }
  function runJobs(now) {
    try {
      if (!curJob) {
        if (!queue.length) { if (!settled && now - idleAt > 500) { settle(); settled = true; } return; }
        curJob = queue.shift(); curJob.i = 0; curJob.t0 = now; settled = false; if (curJob.actor) actors[curJob.actor].active = true; const b = curJob.segs[0].begin; if (b) b();
      }
      const s = curJob.segs[curJob.i]; let u = s.d <= 0 ? 1 : (now - curJob.t0) / s.d; u = Math.min(1, Math.max(0, u)); s.f(s.ease ? s.ease(u) : u);
      if (u >= 1) {
        if (s.end) s.end();
        if (++curJob.i >= curJob.segs.length) {
          const j = curJob; curJob = null; idleAt = now;
          if (j.actor) { if (j.retract) actors[j.actor].active = false; else if (!queue.some(q => q.actor === j.actor)) queue.unshift(retractJob(actors[j.actor])); }
        } else { curJob.t0 = now; const b = curJob.segs[curJob.i].begin; if (b) b(); }
      }
    } catch (e) { console.warn('animation error, resetting board', e); curJob = null; queue = []; settle(); }
  }
  function settle() { // snap everything to its final place and remove anything left over
    Object.keys(pieces).forEach(k => { const o = pieces[k], p = sqPos(k); o.position.set(p.x, TOPY, p.z); o.scale.setScalar(1); o.rotation.y = 0; Object.assign(o.userData, { hold: false, arcY: 0 }); });
    ['w', 'b'].forEach(c => tray[c].forEach((e, i) => { if (!e) return; const p = trayPos(c, i); e.o.position.set(p.x, p.y, p.z); e.o.scale.setScalar(p.s); e.o.userData.hold = false; }));
    const keep = new Set([...Object.values(pieces), ...tray.w.filter(Boolean).map(e => e.o), ...tray.b.filter(Boolean).map(e => e.o)]);
    S.children.filter(o => o.userData && o.userData.isPiece && !keep.has(o)).forEach(o => S.remove(o));
    Object.values(actors).forEach(a => { a.active = false; a.hand.copy(a.restR); });
  }

  /* ---------- sync the 3D scene with the game state ---------- */
  const snapshot = g => { const nw = {}; for (let r = 0; r < 9; r++) for (let c = 0; c < 11; c++) { const p = g.b[r][c]; if (p) nw[keyOf(c, r)] = p.c + p.t; } return nw; };
  function hardReset(g, nw) {
    [...Object.values(pieces), ...tray.w.filter(Boolean).map(e => e.o), ...tray.b.filter(Boolean).map(e => e.o)].forEach(o => S.remove(o));
    S.children.filter(o => o.userData && o.userData.isPiece).forEach(o => S.remove(o));
    pieces = {}; tray = { w: [], b: [] }; queue = []; curJob = null; cur = g; Object.keys(nw).forEach(k => place(k, nw[k])); prev = nw;
    Object.values(actors).forEach(a => { a.active = false; a.hand.copy(a.restR); pose(a, true); }); view('table');
  }
  function sync(g) {
    if (!inited || !g) return; const nw = snapshot(g);
    if (g !== cur) { hardReset(g, nw); marks(g); return; }
    const rem = [], add = [];
    new Set([...Object.keys(prev), ...Object.keys(nw)]).forEach(k => { if (prev[k] !== nw[k]) { if (prev[k]) rem.push(k); if (nw[k]) add.push(k); } });
    if (rem.length || add.length) {
      // FIX: detach every removed mesh first, so a mover arriving on a captured square can never overwrite (and orphan) the captured piece
      const old = {}; rem.forEach(k => { old[k] = pieces[k]; delete pieces[k]; });
      const pending = rem.slice(), moves = [], spawns = [];
      add.forEach(k => { const j = pending.findIndex(rk => prev[rk] === nw[k]); if (j >= 0) { moves.push({ rk: pending.splice(j, 1)[0], k }); } else spawns.push(k); });
      moves.forEach(m => { m.o = old[m.rk]; if (m.o) { pieces[m.k] = m.o; m.o.userData.key = m.k; } });
      const jobs = [];
      pending.forEach(rk => { // captured or removed pieces
        const o = old[rk]; if (!o) return;
        if (spawns.includes(rk)) { jobs.push(poofJob(o)); return; } // promotion swap: the soldier is replaced
        const mv = moves.find(m => m.k === rk), col = prev[rk][0], actor = mv && mv.o ? mv.o.userData.col : (col === 'w' ? 'b' : 'w');
        const i = trayAlloc(col, o, prev[rk][1]); o.userData.key = null; jobs.push(carryJob(o, sqPos(rk), trayPos(col, i), actor, 0.6));
      });
      moves.forEach(m => { if (m.o) jobs.push(carryJob(m.o, sqPos(m.rk), sqPos(m.k), m.o.userData.col, m.o.userData.t === 'C' ? 1.3 : 0.25)); });
      spawns.forEach(k => {
        const col = nw[k][0], t = nw[k][1], i = tray[col].findIndex(e => e && e.t === t);
        if (i >= 0) { const o = tray[col][i].o, A = trayPos(col, i); tray[col][i] = null; pieces[k] = o; o.userData.key = k; jobs.push(carryJob(o, A, sqPos(k), col, 0.6)); }
        else { const o = place(k, nw[k], 0.001); jobs.push(spawnJob(o)); }
      });
      queue.push(...jobs); prev = nw;
    }
    marks(g);
  }
  function ringMesh(a, b, color, y) { const o = new THREE.Mesh(new THREE.RingGeometry(a, b, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })); o.position.y = y; return o; }
  function marks(g) {
    while (mk.children.length) mk.remove(mk.children[0]);
    const selKey = g.sel ? keyOf(g.sel[0], g.sel[1]) : null; Object.keys(pieces).forEach(k => { pieces[k].userData.tl = k === selKey ? 0.2 : 0; });
    const put = (o, c, r) => { const p = wp(c, r); o.position.x = p.x; o.position.z = p.z; mk.add(o); };
    if (g.sel) put(ringMesh(0.36, 0.47, 0x33ccff, TOPY + 0.012), g.sel[0], g.sel[1]);
    (g.mvs || []).forEach(m => {
      const col = m.only ? 0xf0c020 : 0x2fe34f;
      if (g.b[m.y][m.x]) put(ringMesh(0.36, 0.47, col, TOPY + 0.014), m.x, m.y);
      else { const d = new THREE.Mesh(new THREE.CircleGeometry(0.17, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false })); d.position.y = TOPY + 0.014; put(d, m.x, m.y); }
    });
    if (!g.over && chk(g.b, g.turn)) for (let r = 0; r < 9; r++) for (let c = 0; c < 11; c++) { const p = g.b[r][c]; if (p && p.t === 'K' && p.c === g.turn) put(ringMesh(0.3, 0.5, 0xff3b30, TOPY + 0.016), c, r); }
  }

  /* ---------- camera, input, loop ---------- */
  function view(name) {
    if (!dom) return; const a = CAM.aspect || 1.5; let d, el, tg, fov;
    if (name === 'board') { fov = 38; d = 15.5 * Math.min(2.4, Math.max(1, 1.35 / a)); el = 1.0; tg = new V3(0, 0.4, 0.2); }
    else { fov = 44; d = 21.5 * Math.min(1.9, Math.max(1, 1.4 / a)); el = 0.56; tg = new V3(0, 2.0, -1.0); }
    CAM.fov = fov; CAM.updateProjectionMatrix(); CAM.position.set(tg.x, tg.y + Math.sin(el) * d, tg.z + Math.cos(el) * d); CTL.target.copy(tg); CTL.update();
  }
  function fit() { const el = dom && dom.parentNode; if (!el) return; const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; R.setSize(w, h, false); CAM.aspect = w / h; CAM.updateProjectionMatrix(); }
  function pick(e) {
    const rc = dom.getBoundingClientRect(); mouse.set((e.clientX - rc.left) / rc.width * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1); ray.setFromCamera(mouse, CAM);
    const hit = ray.intersectObjects(Object.values(pieces), true)[0];
    if (hit) { let o = hit.object; while (o && !o.userData.key) o = o.parent; if (o) { const [c, r] = kc(o.userData.key); return [c, r]; } }
    const v = new V3(); if (ray.ray.intersectPlane(plane, v)) { const c = Math.round(v.x) + 5, r = 4 - Math.round(v.z); if (ok(c, r)) return [c, r]; }
    return null;
  }
  function init() {
    R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); R.outputEncoding = THREE.sRGBEncoding; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.1;
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    dom = R.domElement; dom.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
    S = new THREE.Scene(); S.background = gradTex([[0, '#34496a'], [0.45, '#161b26'], [1, '#07080b']]); S.fog = new THREE.Fog(0x0b0d12, 34, 80);
    CAM = new THREE.PerspectiveCamera(44, 1.5, 0.1, 150);
    CTL = new THREE.OrbitControls(CAM, dom); Object.assign(CTL, { enableDamping: true, dampingFactor: 0.08, minDistance: 6, maxDistance: 48, minPolarAngle: 0.15, maxPolarAngle: 1.5, enablePan: false, rotateSpeed: 0.7 });
    env(); materials();
    S.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a1d12, 0.4));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4); key.position.set(-6, 16, 8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 50 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.03; S.add(key);
    const rim = new THREE.DirectionalLight(0x7fa6ff, 0.9); rim.position.set(8, 6, -10); S.add(rim);
    buildBoard(); actors.w = person('w'); actors.b = person('b'); Object.values(actors).forEach(a => pose(a, true));
    let dn = null;
    dom.addEventListener('pointerdown', e => { dn = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    dom.addEventListener('pointerup', e => { if (!dn) return; const d = Math.hypot(e.clientX - dn.x, e.clientY - dn.y), dt = performance.now() - dn.t; dn = null; if (d < 6 && dt < 600) { const q = pick(e); if (q && api.onSquare) api.onSquare(q[0], q[1]); } });
    inited = true; (function loop() {
      requestAnimationFrame(loop); if (!dom.isConnected) return; const now = performance.now();
      runJobs(now);
      Object.values(pieces).forEach(o => { const u = o.userData; if (u.hold) return; u.lift += (u.tl - u.lift) * 0.2; o.position.y = TOPY + u.lift + u.arcY; });
      Object.values(actors).forEach(a => pose(a, false, now));
      mk.children.forEach((o, i) => { const s = 1 + 0.07 * Math.sin(now / 260 + i); o.scale.set(s, 1, s); });
      CTL.update(); R.render(S, CAM);
    })();
  }
  const api = {
    onSquare: null, fast: false,
    ok() { if (failed) return false; if (inited) return true; try { const c = document.createElement('canvas'); if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no WebGL'); init(); return true; } catch (e) { failed = true; console.warn('3D unavailable:', e); return false; } },
    mount(el) { if (dom.parentNode !== el) el.appendChild(dom); if (RO) RO.disconnect(); else if (window.ResizeObserver) RO = new ResizeObserver(fit); if (RO) RO.observe(el); fit(); },
    sync, view, reset() { view('table'); },
    busy() { return !!curJob || queue.length > 0; },
    live() { return inited && dom && dom.isConnected; },
    dom() { return dom; },
    snap() { R.render(S, CAM); return dom.toDataURL('image/jpeg', 0.92); },
    _t: { buildPiece, stairOutline, scene: () => S, pieces: () => pieces, tray: () => tray, actors: () => actors, queue: () => queue,
      reach() { let worst = 0; const test = (a, p, y) => { a.hand.set(p.x, y, p.z); worst = Math.max(worst, pose(a, true)); };
        for (let r = 0; r < 9; r++) for (let c = 0; c < 11; c++) if (ok(c, r)) { const p = wp(c, r); ['w', 'b'].forEach(k => { test(actors[k], p, TOPY + 0.78 * 0.95 + 0.45); test(actors[k], p, TOPY + 1.94 * 0.95 + 0.45 + 1.6); }); }
        ['w', 'b'].forEach(c => { for (let i = 0; i < 19; i++) { const p = trayPos(c, i); test(actors[c === 'b' ? 'w' : 'b'], p, TRAYY + 1.2); } });
        Object.values(actors).forEach(a => { a.hand.copy(a.restR); pose(a, true); }); return worst; } }
  };
  return api;
})();
