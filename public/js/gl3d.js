// Winziger 3D-Kern auf WebGL – gerade genug für den Flugsimulator:
// Vektor-/Matrix-/Quaternionen-Mathe, ein Shader mit Vertexfarben,
// Sonnenlicht und Entfernungsnebel, dazu ein Himmelsverlauf.
// Absichtlich WebGL-1-kompatibel geschrieben (läuft damit auch auf
// WebGL 2), ohne Bibliothek und ohne Build-Schritt.

/* ----------------------------------------------------------- Vektoren --- */
export const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  norm(a) {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
};

/* ---------------------------------------------------------- Matrizen ---- */
// 4x4, spaltenweise abgelegt (so erwartet es WebGL)
export const M4 = {
  ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),

  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1]
          + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },

  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    const o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) / (near - far); o[11] = -1;
    o[14] = (2 * far * near) / (near - far);
    return o;
  },

  // Blickmatrix aus Augpunkt und den drei Körperachsen (rechts/oben/vorn)
  view(eye, right, up, fwd) {
    const o = M4.ident();
    const back = [-fwd[0], -fwd[1], -fwd[2]];
    o[0] = right[0]; o[4] = right[1]; o[8] = right[2];
    o[1] = up[0]; o[5] = up[1]; o[9] = up[2];
    o[2] = back[0]; o[6] = back[1]; o[10] = back[2];
    o[12] = -V3.dot(right, eye);
    o[13] = -V3.dot(up, eye);
    o[14] = -V3.dot(back, eye);
    return o;
  },

  // Modellmatrix: Drehung (als 3x3-Achsen) plus Verschiebung und Skalierung
  model(pos, axes, scale = 1) {
    const o = M4.ident();
    const [r, u, f] = axes;
    o[0] = r[0] * scale; o[1] = r[1] * scale; o[2] = r[2] * scale;
    o[4] = u[0] * scale; o[5] = u[1] * scale; o[6] = u[2] * scale;
    o[8] = -f[0] * scale; o[9] = -f[1] * scale; o[10] = -f[2] * scale;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2];
    return o;
  },
};

/* ------------------------------------------------------ Quaternionen ---- */
// Lage des Flugzeugs; Integration über die Drehrate im Körpersystem.
export const Q = {
  ident: () => [1, 0, 0, 0],                       // w, x, y, z

  mul(a, b) {
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
  },

  norm(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },

  // Drehung um eine Körperachse
  axis(ax, ang) {
    const s = Math.sin(ang / 2);
    return [Math.cos(ang / 2), ax[0] * s, ax[1] * s, ax[2] * s];
  },

  // Vektor vom Körper- ins Weltsystem drehen
  rot(q, v) {
    const [w, x, y, z] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [
      v[0] + w * tx + (y * tz - z * ty),
      v[1] + w * ty + (z * tx - x * tz),
      v[2] + w * tz + (x * ty - y * tx),
    ];
  },

  // Vektor von der Welt ins Körpersystem
  unrot(q, v) {
    return Q.rot([q[0], -q[1], -q[2], -q[3]], v);
  },

  // die drei Körperachsen in Weltkoordinaten: rechts, oben, vorwärts
  axes(q) {
    return [Q.rot(q, [1, 0, 0]), Q.rot(q, [0, 1, 0]), Q.rot(q, [0, 0, -1])];
  },

  // Lage als Roll/Nick/Gier (in Grad üblich, hier Radiant)
  euler(q) {
    const [r, u, f] = Q.axes(q);
    const pitch = Math.asin(Math.max(-1, Math.min(1, f[1])));
    const yaw = Math.atan2(f[0], -f[2]);
    // Rollwinkel: Verkippung der rechten Achse gegen die Horizontale
    const hr = V3.norm([-f[2], 0, f[0]]);            // waagerecht rechts
    const roll = Math.atan2(V3.dot(r, [0, 1, 0]), V3.dot(r, hr));
    return { roll: -roll, pitch, yaw };
  },
};

/* ----------------------------------------------------------- Shader ----- */
const VERT = `
precision highp float;
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec3 aCol;
uniform mat4 uVP;
uniform mat4 uModel;
uniform vec3 uEye;
varying vec3 vNrm;
varying vec3 vCol;
varying float vDist;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vNrm = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNrm;
  vCol = aCol;
  vDist = length(wp.xyz - uEye);
  gl_Position = uVP * wp;
}`;

const FRAG = `
precision highp float;
varying vec3 vNrm;
varying vec3 vCol;
varying float vDist;
uniform vec3 uSun;
uniform vec3 uFog;
uniform float uFogDen;
uniform float uTint;
void main() {
  vec3 n = normalize(vNrm);
  float d = max(dot(n, uSun), 0.0);
  float sky = 0.5 + 0.5 * n.y;                  // Himmelslicht von oben
  vec3 c = vCol * (0.46 + 0.2 * sky + 0.46 * d);
  float f = 1.0 - exp(-pow(vDist * uFogDen, 1.7));
  c = mix(c, uFog, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(mix(c, vec3(1.0, 0.35, 0.2), uTint), 1.0);
}`;

// Himmel: ein bildschirmfüllendes Dreieck mit Verlauf und Sonne
const SKY_VERT = `
precision highp float;
attribute vec2 aXY;
uniform mat4 uInv;
varying vec3 vDir;
void main() {
  vec4 p = uInv * vec4(aXY, 1.0, 1.0);
  vDir = p.xyz / p.w;
  gl_Position = vec4(aXY, 1.0, 1.0);
}`;

const SKY_FRAG = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform vec3 uTop;
uniform vec3 uHaze;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 1.6, 0.0, 1.0);
  vec3 c = mix(uHaze, uTop, pow(h, 0.65));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (pow(s, 220.0) * 1.3 + pow(s, 9.0) * 0.16);
  gl_FragColor = vec4(c, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('Shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Programm: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/* ------------------------------------------------------- Mesh-Bauer ----- */
// Sammelt Dreiecke mit Position, Normale und Farbe und lädt sie als ein
// einziges Mesh hoch – ein Zeichenaufruf pro Mesh.
export class MeshBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; }

  get count() { return this.pos.length / 3; }

  vert(p, n, c) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.col.push(c[0], c[1], c[2]);
    return this.count - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  // Viereck aus vier Punkten. Ist eine Normale vorgegeben, wird die
  // Reihenfolge nötigenfalls gedreht, damit die Fläche nach außen zeigt –
  // sonst schluckt die Rückseitenaussonderung sie.
  quad(a, b, c, d, col, nrm) {
    let n = nrm;
    const auto = V3.norm(V3.cross(V3.sub(b, a), V3.sub(c, a)));
    if (!n) n = auto;
    else if (V3.dot(auto, n) < 0) { const t = b; b = d; d = t; }
    const i = this.vert(a, n, col);
    this.vert(b, n, col); this.vert(c, n, col); this.vert(d, n, col);
    this.tri(i, i + 1, i + 2); this.tri(i, i + 2, i + 3);
  }

  // Quader, z. B. Haus oder Rumpfteil
  box(cx, cy, cz, sx, sy, sz, col, top) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy, y1 = cy + sy;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    const t = top || col;
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], t, [0, 1, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, [0, 0, 1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, [0, 0, -1]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, [-1, 0, 0]);
  }

  // Kegel auf einem Stamm – reicht als Baum
  cone(cx, cy, cz, r, h, col, seg = 6) {
    const top = [cx, cy + h, cz];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const p0 = [cx + Math.cos(a0) * r, cy, cz + Math.sin(a0) * r];
      const p1 = [cx + Math.cos(a1) * r, cy, cz + Math.sin(a1) * r];
      const n = V3.norm(V3.cross(V3.sub(p1, p0), V3.sub(top, p0)));
      const i0 = this.vert(p0, n, col);
      this.vert(p1, n, col); this.vert(top, n, col);
      this.tri(i0, i0 + 1, i0 + 2);
    }
  }

  upload(gl) { return new Mesh(gl, this); }
}

export class Mesh {
  constructor(gl, b) {
    this.gl = gl;
    this.n = b.idx.length;
    const mk = (data, type) => {
      const buf = gl.createBuffer();
      const target = type === 'i' ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
      gl.bindBuffer(target, buf);
      gl.bufferData(target, data, gl.STATIC_DRAW);
      return buf;
    };
    this.pos = mk(new Float32Array(b.pos));
    this.nrm = mk(new Float32Array(b.nrm));
    this.col = mk(new Float32Array(b.col));
    this.big = b.pos.length / 3 > 65535;
    this.idx = mk(this.big ? new Uint32Array(b.idx) : new Uint16Array(b.idx), 'i');
  }
}

/* ----------------------------------------------------------- Renderer --- */
export class Renderer {
  constructor(canvas) {
    const opts = { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts)
      || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL steht nicht zur Verfügung');
    this.gl = gl;
    this.gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (!this.gl2) gl.getExtension('OES_element_index_uint');

    this.prog = program(gl, VERT, FRAG);
    this.loc = {};
    for (const n of ['uVP', 'uModel', 'uEye', 'uSun', 'uFog', 'uFogDen', 'uTint']) {
      this.loc[n] = gl.getUniformLocation(this.prog, n);
    }
    this.attr = {
      aPos: gl.getAttribLocation(this.prog, 'aPos'),
      aNrm: gl.getAttribLocation(this.prog, 'aNrm'),
      aCol: gl.getAttribLocation(this.prog, 'aCol'),
    };

    this.sky = program(gl, SKY_VERT, SKY_FRAG);
    this.skyLoc = {
      uInv: gl.getUniformLocation(this.sky, 'uInv'),
      uSunDir: gl.getUniformLocation(this.sky, 'uSunDir'),
      uTop: gl.getUniformLocation(this.sky, 'uTop'),
      uHaze: gl.getUniformLocation(this.sky, 'uHaze'),
    };
    this.skyAttr = gl.getAttribLocation(this.sky, 'aXY');
    this.skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.sun = V3.norm([0.42, 0.72, 0.32]);
    this.fog = [0.74, 0.80, 0.88];
    this.fogDen = 0.000085;
    this.skyTop = [0.26, 0.47, 0.78];
    this.tint = 0;
  }

  resize(w, h, dpr) {
    const c = this.gl.canvas;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    this.gl.viewport(0, 0, c.width, c.height);
    this.aspect = w / h;
  }

  // Blickrichtung setzen; liefert die kombinierte Sicht-/Projektionsmatrix
  camera(eye, axes, fovDeg, near, far) {
    this.eye = eye;
    const proj = M4.perspective((fovDeg * Math.PI) / 180, this.aspect || 1, near, far);
    const view = M4.view(eye, axes[0], axes[1], axes[2]);
    this.vp = M4.mul(proj, view);
    // Inverse nur für den Himmel: Richtung je Pixel aus der Bildschirmecke
    const inv = M4.ident();
    const f = Math.tan(((fovDeg * Math.PI) / 180) / 2);
    inv[0] = f * (this.aspect || 1); inv[5] = f; inv[10] = 0; inv[11] = 0;
    inv[14] = -1; inv[15] = 1;
    const rot = M4.ident();
    const [r, u, fw] = axes;
    rot[0] = r[0]; rot[1] = r[1]; rot[2] = r[2];
    rot[4] = u[0]; rot[5] = u[1]; rot[6] = u[2];
    rot[8] = -fw[0]; rot[9] = -fw[1]; rot[10] = -fw[2];
    this.skyInv = M4.mul(rot, inv);
    return this.vp;
  }

  drawSky() {
    const gl = this.gl;
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.sky);
    gl.uniformMatrix4fv(this.skyLoc.uInv, false, this.skyInv);
    gl.uniform3fv(this.skyLoc.uSunDir, this.sun);
    gl.uniform3fv(this.skyLoc.uTop, this.skyTop);
    gl.uniform3fv(this.skyLoc.uHaze, this.fog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.skyBuf);
    gl.enableVertexAttribArray(this.skyAttr);
    gl.vertexAttribPointer(this.skyAttr, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  begin() {
    const gl = this.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.loc.uVP, false, this.vp);
    gl.uniform3fv(this.loc.uEye, this.eye);
    gl.uniform3fv(this.loc.uSun, this.sun);
    gl.uniform3fv(this.loc.uFog, this.fog);
    gl.uniform1f(this.loc.uFogDen, this.fogDen);
    gl.uniform1f(this.loc.uTint, this.tint);
  }

  draw(mesh, model) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.loc.uModel, false, model || M4.ident());
    const bind = (buf, loc) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    bind(mesh.pos, this.attr.aPos);
    bind(mesh.nrm, this.attr.aNrm);
    bind(mesh.col, this.attr.aCol);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
    gl.drawElements(gl.TRIANGLES, mesh.n, mesh.big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
  }
}
