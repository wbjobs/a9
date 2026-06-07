export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class HeightFieldGenerator {
  private resolution: number;
  private bounds: Bounds;
  private heightData: Float32Array;
  private normals: Float32Array;
  private weights: Float32Array;
  private gridSizeX: number;
  private gridSizeY: number;

  constructor(resolution: number, bounds: Bounds) {
    this.resolution = resolution;
    this.bounds = bounds;
    this.gridSizeX = resolution;
    this.gridSizeY = resolution;
    this.heightData = new Float32Array(this.gridSizeX * this.gridSizeY);
    this.normals = new Float32Array(this.gridSizeX * this.gridSizeY * 3);
    this.weights = new Float32Array(this.gridSizeX * this.gridSizeY);
  }

  generate(
    positions: Float32Array,
    densities: Float32Array,
    particleCount: number,
    smoothingRadius: number
  ): void {
    this.heightData.fill(0);
    this.weights.fill(0);

    const { minX, maxX, minY, maxY } = this.bounds;
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const cellSizeX = rangeX / (this.gridSizeX - 1);
    const cellSizeY = rangeY / (this.gridSizeY - 1);
    const h2 = smoothingRadius * smoothingRadius;
    const invH2 = 1 / h2;

    const radiusInCellsX = Math.ceil(smoothingRadius / cellSizeX);
    const radiusInCellsY = Math.ceil(smoothingRadius / cellSizeY);

    for (let i = 0; i < particleCount; i++) {
      const px = positions[i * 2];
      const py = positions[i * 2 + 1];
      const density = densities[i];

      const gx = ((px - minX) / rangeX) * (this.gridSizeX - 1);
      const gy = ((py - minY) / rangeY) * (this.gridSizeY - 1);

      const startX = Math.max(0, Math.floor(gx - radiusInCellsX));
      const endX = Math.min(this.gridSizeX - 1, Math.ceil(gx + radiusInCellsX));
      const startY = Math.max(0, Math.floor(gy - radiusInCellsY));
      const endY = Math.min(this.gridSizeY - 1, Math.ceil(gy + radiusInCellsY));

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const dx = x - gx;
          const dy = y - gy;
          const r2 = dx * dx + dy * dy;

          if (r2 < h2) {
            const weight = Math.exp(-r2 * invH2);
            const idx = y * this.gridSizeX + x;
            this.heightData[idx] += density * weight;
            this.weights[idx] += weight;
          }
        }
      }
    }

    for (let i = 0; i < this.heightData.length; i++) {
      if (this.weights[i] > 0) {
        this.heightData[i] /= this.weights[i];
      }
    }
  }

  computeNormals(heightData: Float32Array): void {
    const { minX, maxX, minY, maxY } = this.bounds;
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const cellSizeX = rangeX / (this.gridSizeX - 1);
    const cellSizeY = rangeY / (this.gridSizeY - 1);

    for (let y = 0; y < this.gridSizeY; y++) {
      for (let x = 0; x < this.gridSizeX; x++) {
        const idx = y * this.gridSizeX + x;

        const hL = x > 0 ? heightData[idx - 1] : heightData[idx];
        const hR = x < this.gridSizeX - 1 ? heightData[idx + 1] : heightData[idx];
        const hD = y > 0 ? heightData[idx - this.gridSizeX] : heightData[idx];
        const hU = y < this.gridSizeY - 1 ? heightData[idx + this.gridSizeX] : heightData[idx];

        const dhdx = (hR - hL) / (2 * cellSizeX);
        const dhdy = (hU - hD) / (2 * cellSizeY);

        const nx = -dhdx;
        const ny = -dhdy;
        const nz = 1;

        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const nIdx = idx * 3;
        this.normals[nIdx] = nx / len;
        this.normals[nIdx + 1] = nz / len;
        this.normals[nIdx + 2] = ny / len;
      }
    }
  }

  getData(): Float32Array {
    return this.heightData;
  }

  getNormals(): Float32Array {
    return this.normals;
  }
}
