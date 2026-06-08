import type { SimulationParams, ObstacleData, HeightField } from '../../../shared/types';
import { loadShader } from './shaderLoader';

interface GPUBuffers {
  positions: [GPUBuffer, GPUBuffer];
  velocities: [GPUBuffer, GPUBuffer];
  densities: GPUBuffer;
  pressures: GPUBuffer;
  cellCounts: GPUBuffer;
  cellStart: GPUBuffer;
  cellEnd: GPUBuffer;
  cellCounters: GPUBuffer;
  scanBlockSums: GPUBuffer;
  particleIndices: GPUBuffer;
  obstacles: GPUBuffer;
  heightField: GPUBuffer;
  heightFieldWeights: GPUBuffer;
  normals: GPUBuffer;
  params: GPUBuffer;
  obstacleCount: GPUBuffer;
  clearBuffer: GPUBuffer;
}

interface ComputePipelines {
  hashCount: GPUComputePipeline;
  scanBlock: GPUComputePipeline;
  addBlockSums: GPUComputePipeline;
  sortIndices: GPUComputePipeline;
  densityPressure: GPUComputePipeline;
  forceIntegrate: GPUComputePipeline;
  heightField: GPUComputePipeline;
  computeNormals: GPUComputePipeline;
}

interface BindGroups {
  hashCount: GPUBindGroup;
  scan: GPUBindGroup;
  addBlockSums: GPUBindGroup;
  sortIndices: GPUBindGroup;
  densityPressure: GPUBindGroup;
  forceIntegrate: GPUBindGroup;
  heightField: GPUBindGroup;
  computeNormals: GPUBindGroup;
}

const BOUNDARY_MIN_X = 0;
const BOUNDARY_MAX_X = 1200;
const BOUNDARY_MIN_Y = 0;
const BOUNDARY_MAX_Y = 800;
const HEIGHT_FIELD_RES = 128;
const SCAN_BLOCK_SIZE = 512;

const OBSTACLE_TYPE_MAP: Record<string, number> = {
  circle: 0,
  line: 1,
  rect: 2,
};

export class SPHSimulator {
  private canvas: HTMLCanvasElement;
  private device!: GPUDevice;
  private adapter!: GPUAdapter;
  private params!: SimulationParams;
  private gridSize!: number;
  private gridResX!: number;
  private gridResY!: number;
  private heightFieldRes: number = HEIGHT_FIELD_RES;
  private particleCount!: number;
  private numScanBlocks!: number;

  private buffers!: GPUBuffers;
  private pipelines!: ComputePipelines;
  private bindGroups!: BindGroups;

  private pingPongIndex: number = 0;
  private uniformParamsData!: Float32Array;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(params: SimulationParams): Promise<void> {
    this.params = params;
    this.particleCount = params.particleCount;
    this.gridSize = params.smoothingRadius;
    this.gridResX = Math.ceil((BOUNDARY_MAX_X - BOUNDARY_MIN_X) / this.gridSize);
    this.gridResY = Math.ceil((BOUNDARY_MAX_Y - BOUNDARY_MIN_Y) / this.gridSize);
    this.numScanBlocks = Math.ceil((this.gridResX * this.gridResY) / SCAN_BLOCK_SIZE);

    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    this.adapter = (await navigator.gpu.requestAdapter())!;
    if (!this.adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    this.device = await this.adapter.requestDevice();

    this.createBuffers();
    await this.initParticleData();
    await this.createPipelines();
    this.createBindGroups();
  }

  private async initParticleData(): Promise<void> {
    const positions = new Float32Array(this.particleCount * 2);
    const velocities = new Float32Array(this.particleCount * 2);

    const margin = 50;
    const width = BOUNDARY_MAX_X - BOUNDARY_MIN_X - margin * 2;
    const height = BOUNDARY_MAX_Y - BOUNDARY_MIN_Y - margin * 2;

    const cols = Math.ceil(Math.sqrt(this.particleCount * width / height));
    const rows = Math.ceil(this.particleCount / cols);
    const spacing = Math.min(width / cols, height / rows);

    let idx = 0;
    for (let row = 0; row < rows && idx < this.particleCount; row++) {
      for (let col = 0; col < cols && idx < this.particleCount; col++) {
        positions[idx * 2] = BOUNDARY_MIN_X + margin + col * spacing + (Math.random() - 0.5) * spacing * 0.3;
        positions[idx * 2 + 1] = BOUNDARY_MIN_Y + margin + row * spacing * 0.5 + (Math.random() - 0.5) * spacing * 0.3;
        velocities[idx * 2] = 0;
        velocities[idx * 2 + 1] = 0;
        idx++;
      }
    }

    await this.setParticleData(positions, velocities);
  }

  private createBuffer(size: number, usage: GPUBufferUsageFlags, mappedAtCreation: boolean = false): GPUBuffer {
    return this.device.createBuffer({
      size: Math.max(size, 4),
      usage,
      mappedAtCreation,
    });
  }

  private createBuffers(): void {
    const particleCount = this.particleCount;
    const cellCount = this.gridResX * this.gridResY;
    const heightFieldSize = this.heightFieldRes * this.heightFieldRes;

    const positionsBuffer0 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );

    const positionsBuffer1 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );

    const velocitiesBuffer0 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    const velocitiesBuffer1 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    const clearData = new Uint32Array(Math.max(cellCount, particleCount));
    clearData.fill(0);
    const clearBuffer = this.device.createBuffer({
      size: clearData.byteLength,
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
      mappedAtCreation: true,
    });
    new Uint32Array(clearBuffer.getMappedRange()).set(clearData);
    clearBuffer.unmap();

    this.buffers = {
      positions: [positionsBuffer0, positionsBuffer1],
      velocities: [velocitiesBuffer0, velocitiesBuffer1],
      densities: this.createBuffer(
        particleCount * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      pressures: this.createBuffer(
        particleCount * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      cellCounts: this.createBuffer(
        cellCount * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      ),
      cellStart: this.createBuffer(
        cellCount * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      ),
      cellEnd: this.createBuffer(
        cellCount * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      ),
      cellCounters: this.createBuffer(
        cellCount * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      scanBlockSums: this.createBuffer(
        this.numScanBlocks * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      particleIndices: this.createBuffer(
        particleCount * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      obstacles: this.createBuffer(
        32 * 7 * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      heightField: this.createBuffer(
        heightFieldSize * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      ),
      heightFieldWeights: this.createBuffer(
        heightFieldSize * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      normals: this.createBuffer(
        heightFieldSize * 3 * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      ),
      params: this.createBuffer(
        18 * Float32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      ),
      obstacleCount: this.createBuffer(
        Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
      ),
      clearBuffer,
    };

    this.updateParams(this.params);
  }

  private async createPipelines(): Promise<void> {
    const [hashCountShader, scanShader, sortIndicesShader, densityPressureShader, forceIntegrateShader, heightFieldShader] =
      await Promise.all([
        loadShader('hash_count.wgsl'),
        loadShader('scan.wgsl'),
        loadShader('sort_indices.wgsl'),
        loadShader('density_pressure.wgsl'),
        loadShader('force_integrate.wgsl'),
        loadShader('height_field.wgsl'),
      ]);

    this.pipelines = {
      hashCount: this.createComputePipeline(hashCountShader, 'main'),
      scanBlock: this.createComputePipeline(scanShader, 'scanBlock'),
      addBlockSums: this.createComputePipeline(scanShader, 'addBlockSums'),
      sortIndices: this.createComputePipeline(sortIndicesShader, 'main'),
      densityPressure: this.createComputePipeline(densityPressureShader, 'main'),
      forceIntegrate: this.createComputePipeline(forceIntegrateShader, 'main'),
      heightField: this.createComputePipeline(heightFieldShader, 'main'),
      computeNormals: this.createComputePipeline(heightFieldShader, 'computeNormals'),
    };
  }

  private createComputePipeline(shaderCode: string, entryPoint: string): GPUComputePipeline {
    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
    });

    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint,
      },
    });
  }

  private createBindGroups(): void {
    this.bindGroups = {
      hashCount: this.createHashCountBindGroup(),
      scan: this.createScanBindGroup(),
      addBlockSums: this.createAddBlockSumsBindGroup(),
      sortIndices: this.createSortIndicesBindGroup(),
      densityPressure: this.createDensityPressureBindGroup(),
      forceIntegrate: this.createForceIntegrateBindGroup(),
      heightField: this.createHeightFieldBindGroup(),
      computeNormals: this.createComputeNormalsBindGroup(),
    };
  }

  private createHashCountBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.hashCount.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.params } },
        { binding: 1, resource: { buffer: this.buffers.positions[this.pingPongIndex] } },
        { binding: 2, resource: { buffer: this.buffers.cellCounts } },
      ],
    });
  }

  private createScanBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.scanBlock.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.cellCounts } },
        { binding: 1, resource: { buffer: this.buffers.cellStart } },
        { binding: 2, resource: { buffer: this.buffers.scanBlockSums } },
      ],
    });
  }

  private createAddBlockSumsBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.addBlockSums.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.cellCounts } },
        { binding: 1, resource: { buffer: this.buffers.cellStart } },
        { binding: 2, resource: { buffer: this.buffers.scanBlockSums } },
      ],
    });
  }

  private createSortIndicesBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.sortIndices.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.params } },
        { binding: 1, resource: { buffer: this.buffers.positions[this.pingPongIndex] } },
        { binding: 2, resource: { buffer: this.buffers.cellStart } },
        { binding: 3, resource: { buffer: this.buffers.cellCounters } },
        { binding: 4, resource: { buffer: this.buffers.particleIndices } },
      ],
    });
  }

  private createDensityPressureBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.densityPressure.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.params } },
        { binding: 1, resource: { buffer: this.buffers.positions[this.pingPongIndex] } },
        { binding: 2, resource: { buffer: this.buffers.densities } },
        { binding: 3, resource: { buffer: this.buffers.pressures } },
        { binding: 4, resource: { buffer: this.buffers.cellStart } },
        { binding: 5, resource: { buffer: this.buffers.cellEnd } },
        { binding: 6, resource: { buffer: this.buffers.particleIndices } },
      ],
    });
  }

  private createForceIntegrateBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.forceIntegrate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.params } },
        { binding: 1, resource: { buffer: this.buffers.positions[this.pingPongIndex] } },
        { binding: 2, resource: { buffer: this.buffers.velocities[this.pingPongIndex] } },
        { binding: 3, resource: { buffer: this.buffers.densities } },
        { binding: 4, resource: { buffer: this.buffers.pressures } },
        { binding: 5, resource: { buffer: this.buffers.positions[1 - this.pingPongIndex] } },
        { binding: 6, resource: { buffer: this.buffers.velocities[1 - this.pingPongIndex] } },
        { binding: 7, resource: { buffer: this.buffers.cellStart } },
        { binding: 8, resource: { buffer: this.buffers.cellEnd } },
        { binding: 9, resource: { buffer: this.buffers.particleIndices } },
        { binding: 10, resource: { buffer: this.buffers.obstacles } },
        { binding: 11, resource: { buffer: this.buffers.obstacleCount } },
      ],
    });
  }

  private createHeightFieldBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.heightField.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.params } },
        { binding: 1, resource: { buffer: this.buffers.positions[1 - this.pingPongIndex] } },
        { binding: 2, resource: { buffer: this.buffers.densities } },
        { binding: 3, resource: { buffer: this.buffers.heightField } },
        { binding: 4, resource: { buffer: this.buffers.heightFieldWeights } },
        { binding: 5, resource: { buffer: this.buffers.normals } },
        { binding: 6, resource: { buffer: this.buffers.cellStart } },
        { binding: 7, resource: { buffer: this.buffers.cellEnd } },
        { binding: 8, resource: { buffer: this.buffers.particleIndices } },
      ],
    });
  }

  private createComputeNormalsBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.pipelines.computeNormals.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.buffers.params } },
        { binding: 1, resource: { buffer: this.buffers.positions[1 - this.pingPongIndex] } },
        { binding: 2, resource: { buffer: this.buffers.densities } },
        { binding: 3, resource: { buffer: this.buffers.heightField } },
        { binding: 4, resource: { buffer: this.buffers.heightFieldWeights } },
        { binding: 5, resource: { buffer: this.buffers.normals } },
        { binding: 6, resource: { buffer: this.buffers.cellStart } },
        { binding: 7, resource: { buffer: this.buffers.cellEnd } },
        { binding: 8, resource: { buffer: this.buffers.particleIndices } },
      ],
    });
  }

  private updateParamsBuffer(): void {
    const cellCount = this.gridResX * this.gridResY;
    const paramsData = new Float32Array(18);
    paramsData[0] = this.params.particleCount;
    paramsData[1] = this.params.smoothingRadius;
    paramsData[2] = this.params.restDensity;
    paramsData[3] = this.params.viscosity;
    paramsData[4] = this.params.pressureStiffness;
    paramsData[5] = this.params.gravityX;
    paramsData[6] = this.params.gravityY;
    paramsData[7] = this.params.damping;
    paramsData[8] = BOUNDARY_MIN_X;
    paramsData[9] = BOUNDARY_MAX_X;
    paramsData[10] = BOUNDARY_MIN_Y;
    paramsData[11] = BOUNDARY_MAX_Y;
    paramsData[12] = this.params.timeStep;
    paramsData[13] = this.gridSize;
    paramsData[14] = this.gridResX;
    paramsData[15] = this.gridResY;
    paramsData[16] = this.heightFieldRes;
    paramsData[17] = 0;

    this.device.queue.writeBuffer(this.buffers.params, 0, paramsData);
  }

  updateParams(params: SimulationParams): void {
    this.params = params;
    this.particleCount = params.particleCount;
    this.gridSize = params.smoothingRadius;
    this.gridResX = Math.ceil((BOUNDARY_MAX_X - BOUNDARY_MIN_X) / this.gridSize);
    this.gridResY = Math.ceil((BOUNDARY_MAX_Y - BOUNDARY_MIN_Y) / this.gridSize);
    this.updateParamsBuffer();
  }

  updateObstacles(obstacles: ObstacleData[]): void {
    const obstacleCount = obstacles.length;
    const maxObstacles = 32;
    const obstacleData = new Float32Array(maxObstacles * 7);

    for (let i = 0; i < Math.min(obstacleCount, maxObstacles); i++) {
      const obs = obstacles[i];
      obstacleData[i * 7] = OBSTACLE_TYPE_MAP[obs.type] ?? 0;
      obstacleData[i * 7 + 1] = obs.x;
      obstacleData[i * 7 + 2] = obs.y;
      obstacleData[i * 7 + 3] = obs.radius ?? 0;
      obstacleData[i * 7 + 4] = obs.width ?? 0;
      obstacleData[i * 7 + 5] = obs.height ?? 0;
      obstacleData[i * 7 + 6] = obs.rotation ?? 0;
    }

    this.device.queue.writeBuffer(this.buffers.obstacles, 0, obstacleData);
    this.device.queue.writeBuffer(this.buffers.obstacleCount, 0, new Uint32Array([Math.min(obstacleCount, maxObstacles)]));
  }

  async step(): Promise<void> {
    const cellCount = this.gridResX * this.gridResY;
    const cellCountBytes = cellCount * Uint32Array.BYTES_PER_ELEMENT;

    const commandEncoder = this.device.createCommandEncoder();

    commandEncoder.copyBufferToBuffer(
      this.buffers.clearBuffer,
      0,
      this.buffers.cellCounts,
      0,
      cellCountBytes
    );

    commandEncoder.copyBufferToBuffer(
      this.buffers.clearBuffer,
      0,
      this.buffers.cellCounters,
      0,
      cellCountBytes
    );

    const hashCountPass = commandEncoder.beginComputePass();
    hashCountPass.setPipeline(this.pipelines.hashCount);
    hashCountPass.setBindGroup(0, this.bindGroups.hashCount);
    hashCountPass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    hashCountPass.end();

    const scanPass = commandEncoder.beginComputePass();
    scanPass.setPipeline(this.pipelines.scanBlock);
    scanPass.setBindGroup(0, this.bindGroups.scan);
    scanPass.dispatchWorkgroups(this.numScanBlocks);
    scanPass.end();

    if (this.numScanBlocks > 1) {
      const addBlockSumsPass = commandEncoder.beginComputePass();
      addBlockSumsPass.setPipeline(this.pipelines.addBlockSums);
      addBlockSumsPass.setBindGroup(0, this.bindGroups.addBlockSums);
      addBlockSumsPass.dispatchWorkgroups(Math.ceil(cellCount / 256));
      addBlockSumsPass.end();
    }

    commandEncoder.copyBufferToBuffer(
      this.buffers.cellCounts,
      0,
      this.buffers.cellEnd,
      0,
      cellCountBytes
    );

    const sortIndicesPass = commandEncoder.beginComputePass();
    sortIndicesPass.setPipeline(this.pipelines.sortIndices);
    sortIndicesPass.setBindGroup(0, this.bindGroups.sortIndices);
    sortIndicesPass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    sortIndicesPass.end();

    const densityPressurePass = commandEncoder.beginComputePass();
    densityPressurePass.setPipeline(this.pipelines.densityPressure);
    densityPressurePass.setBindGroup(0, this.bindGroups.densityPressure);
    densityPressurePass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    densityPressurePass.end();

    const forceIntegratePass = commandEncoder.beginComputePass();
    forceIntegratePass.setPipeline(this.pipelines.forceIntegrate);
    forceIntegratePass.setBindGroup(0, this.bindGroups.forceIntegrate);
    forceIntegratePass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    forceIntegratePass.end();

    const heightFieldPass = commandEncoder.beginComputePass();
    heightFieldPass.setPipeline(this.pipelines.heightField);
    heightFieldPass.setBindGroup(0, this.bindGroups.heightField);
    heightFieldPass.dispatchWorkgroups(
      Math.ceil(this.heightFieldRes / 16),
      Math.ceil(this.heightFieldRes / 16)
    );
    heightFieldPass.end();

    const computeNormalsPass = commandEncoder.beginComputePass();
    computeNormalsPass.setPipeline(this.pipelines.computeNormals);
    computeNormalsPass.setBindGroup(0, this.bindGroups.computeNormals);
    computeNormalsPass.dispatchWorkgroups(
      Math.ceil(this.heightFieldRes / 16),
      Math.ceil(this.heightFieldRes / 16)
    );
    computeNormalsPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    this.pingPongIndex = 1 - this.pingPongIndex;

    this.bindGroups.hashCount = this.createHashCountBindGroup();
    this.bindGroups.scan = this.createScanBindGroup();
    this.bindGroups.addBlockSums = this.createAddBlockSumsBindGroup();
    this.bindGroups.sortIndices = this.createSortIndicesBindGroup();
    this.bindGroups.densityPressure = this.createDensityPressureBindGroup();
    this.bindGroups.forceIntegrate = this.createForceIntegrateBindGroup();
    this.bindGroups.heightField = this.createHeightFieldBindGroup();
    this.bindGroups.computeNormals = this.createComputeNormalsBindGroup();
  }

  async getPositions(): Promise<Float32Array> {
    try {
      const positionsBuffer = this.buffers.positions[this.pingPongIndex];
      await positionsBuffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(positionsBuffer.getMappedRange());
      const result = new Float32Array(data);
      positionsBuffer.unmap();
      return result;
    } catch (e) {
      console.warn('getPositions failed:', e);
      return new Float32Array(this.particleCount * 2);
    }
  }

  async getHeightField(): Promise<HeightField> {
    const heightFieldSize = this.heightFieldRes * this.heightFieldRes;

    try {
      await this.buffers.heightField.mapAsync(GPUMapMode.READ);
      const heightData = new Float32Array(this.buffers.heightField.getMappedRange());
      const heightResult = new Float32Array(heightData);
      this.buffers.heightField.unmap();

      await this.buffers.normals.mapAsync(GPUMapMode.READ);
      const normalData = new Float32Array(this.buffers.normals.getMappedRange());
      const normalResult = new Float32Array(normalData);
      this.buffers.normals.unmap();

      return {
        width: this.heightFieldRes,
        height: this.heightFieldRes,
        data: heightResult,
        normals: normalResult,
      };
    } catch (e) {
      console.warn('getHeightField failed:', e);
      return {
        width: this.heightFieldRes,
        height: this.heightFieldRes,
        data: new Float32Array(heightFieldSize),
        normals: new Float32Array(heightFieldSize * 3),
      };
    }
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  getAdapter(): GPUAdapter {
    return this.adapter;
  }

  async reinitializeParticles(): Promise<void> {
    await this.initParticleData();
  }

  async setParticleData(positions: Float32Array, velocities: Float32Array): Promise<void> {
    const writeBuffer = async (buffer: GPUBuffer, data: Float32Array) => {
      const stagingBuffer = this.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.MAP_WRITE,
        mappedAtCreation: true,
      });
      new Float32Array(stagingBuffer.getMappedRange()).set(data);
      stagingBuffer.unmap();

      const commandEncoder = this.device.createCommandEncoder();
      commandEncoder.copyBufferToBuffer(stagingBuffer, 0, buffer, 0, data.byteLength);
      this.device.queue.submit([commandEncoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
    };

    await Promise.all([
      writeBuffer(this.buffers.positions[0], positions),
      writeBuffer(this.buffers.positions[1], positions),
      writeBuffer(this.buffers.velocities[0], velocities),
      writeBuffer(this.buffers.velocities[1], velocities),
    ]);
  }
}
