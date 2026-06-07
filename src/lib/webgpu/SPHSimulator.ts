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
  particleIndices: GPUBuffer;
  obstacles: GPUBuffer;
  heightField: GPUBuffer;
  heightFieldWeights: GPUBuffer;
  normals: GPUBuffer;
  params: GPUBuffer;
  obstacleCount: GPUBuffer;
}

interface ComputePipelines {
  hashCount: GPUComputePipeline;
  densityPressure: GPUComputePipeline;
  forceIntegrate: GPUComputePipeline;
  heightField: GPUComputePipeline;
  computeNormals: GPUComputePipeline;
}

interface BindGroups {
  hashCount: GPUBindGroup;
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

  private buffers!: GPUBuffers;
  private pipelines!: ComputePipelines;
  private bindGroups!: BindGroups;

  private cellCountsData!: Uint32Array;
  private cellStartData!: Int32Array;
  private cellEndData!: Int32Array;
  private particleIndicesData!: Uint32Array;

  private pingPongIndex: number = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(params: SimulationParams): Promise<void> {
    this.params = params;
    this.particleCount = params.particleCount;
    this.gridSize = params.smoothingRadius;
    this.gridResX = Math.ceil((BOUNDARY_MAX_X - BOUNDARY_MIN_X) / this.gridSize);
    this.gridResY = Math.ceil((BOUNDARY_MAX_Y - BOUNDARY_MIN_Y) / this.gridSize);

    if (!navigator.gpu) {
      throw new Error('WebGPU is not supported in this browser');
    }

    this.adapter = (await navigator.gpu.requestAdapter())!;
    if (!this.adapter) {
      throw new Error('Failed to get GPU adapter');
    }

    this.device = await this.adapter.requestDevice();

    this.cellCountsData = new Uint32Array(this.gridResX * this.gridResY);
    this.cellStartData = new Int32Array(this.gridResX * this.gridResY);
    this.cellEndData = new Int32Array(this.gridResX * this.gridResY);
    this.particleIndicesData = new Uint32Array(this.particleCount);

    this.createBuffers();
    this.initParticleData();
    await this.createPipelines();
    this.createBindGroups();
  }

  private initParticleData(): void {
    const positions = new Float32Array(this.particleCount * 2);
    const velocities = new Float32Array(this.particleCount * 2);

    const margin = 50;
    const width = BOUNDARY_MAX_X - BOUNDARY_MIN_X - margin * 2;
    const height = BOUNDARY_MAX_Y - BOUNDARY_MIN_Y - margin * 2;

    for (let i = 0; i < this.particleCount; i++) {
      positions[i * 2] = BOUNDARY_MIN_X + margin + Math.random() * width;
      positions[i * 2 + 1] = BOUNDARY_MIN_Y + margin + Math.random() * height * 0.5;
      velocities[i * 2] = 0;
      velocities[i * 2 + 1] = 0;
    }

    new Float32Array(this.buffers.positions[0].getMappedRange()).set(positions);
    this.buffers.positions[0].unmap();

    new Float32Array(this.buffers.positions[1].getMappedRange()).set(positions);
    this.buffers.positions[1].unmap();

    new Float32Array(this.buffers.velocities[0].getMappedRange()).set(velocities);
    this.buffers.velocities[0].unmap();

    new Float32Array(this.buffers.velocities[1].getMappedRange()).set(velocities);
    this.buffers.velocities[1].unmap();
  }

  private createBuffer(size: number, usage: GPUBufferUsageFlags, mappedAtCreation: boolean = false): GPUBuffer {
    return this.device.createBuffer({
      size,
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
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      true
    );

    const positionsBuffer1 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      true
    );

    const velocitiesBuffer0 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      true
    );

    const velocitiesBuffer1 = this.createBuffer(
      particleCount * 2 * Float32Array.BYTES_PER_ELEMENT,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      true
    );

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
        cellCount * Int32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      cellEnd: this.createBuffer(
        cellCount * Int32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      particleIndices: this.createBuffer(
        particleCount * Uint32Array.BYTES_PER_ELEMENT,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      ),
      obstacles: this.createBuffer(
        16 * Float32Array.BYTES_PER_ELEMENT,
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
    };

    this.updateParams(this.params);
  }

  private async createPipelines(): Promise<void> {
    const [hashCountShader, densityPressureShader, forceIntegrateShader, heightFieldShader] =
      await Promise.all([
        loadShader('hash_count.wgsl'),
        loadShader('density_pressure.wgsl'),
        loadShader('force_integrate.wgsl'),
        loadShader('height_field.wgsl'),
      ]);

    this.pipelines = {
      hashCount: this.createComputePipeline(hashCountShader, 'main'),
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
      ],
    });
  }

  private updateParamsBuffer(): void {
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
    const obstacleData = new Float32Array(obstacleCount * 7);

    for (let i = 0; i < obstacleCount; i++) {
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
    this.device.queue.writeBuffer(this.buffers.obstacleCount, 0, new Uint32Array([obstacleCount]));
  }

  private async readCellCounts(): Promise<Uint32Array> {
    const cellCount = this.gridResX * this.gridResY;
    const readBuffer = this.device.createBuffer({
      size: cellCount * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = this.device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      this.buffers.cellCounts,
      0,
      readBuffer,
      0,
      cellCount * Uint32Array.BYTES_PER_ELEMENT
    );
    this.device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(readBuffer.getMappedRange());
    const result = new Uint32Array(data);
    readBuffer.unmap();
    readBuffer.destroy();

    return result;
  }

  private computePrefixSum(cellCounts: Uint32Array): void {
    const cellCount = this.gridResX * this.gridResY;
    let prefixSum = 0;

    for (let i = 0; i < cellCount; i++) {
      this.cellStartData[i] = prefixSum;
      this.cellEndData[i] = prefixSum + cellCounts[i];
      prefixSum += cellCounts[i];
    }
  }

  private async readPositions(bufferIndex?: number): Promise<Float32Array> {
    const index = bufferIndex ?? this.pingPongIndex;
    const positionsBuffer = this.buffers.positions[index];
    await positionsBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(positionsBuffer.getMappedRange());
    const result = new Float32Array(data);
    positionsBuffer.unmap();
    return result;
  }

  private fillParticleIndices(positions: Float32Array): void {
    const cellCount = this.gridResX * this.gridResY;
    const cellCounters = new Uint32Array(cellCount);

    for (let i = 0; i < cellCount; i++) {
      cellCounters[i] = 0;
    }

    for (let i = 0; i < this.particleCount; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];

      const cellX = Math.max(0, Math.min(this.gridResX - 1, Math.floor((x - BOUNDARY_MIN_X) / this.gridSize)));
      const cellY = Math.max(0, Math.min(this.gridResY - 1, Math.floor((y - BOUNDARY_MIN_Y) / this.gridSize)));
      const cellHash = cellY * this.gridResX + cellX;

      const index = this.cellStartData[cellHash] + cellCounters[cellHash];
      this.particleIndicesData[index] = i;
      cellCounters[cellHash]++;
    }

    this.device.queue.writeBuffer(this.buffers.particleIndices, 0, this.particleIndicesData);
  }

  async step(): Promise<void> {
    this.device.queue.writeBuffer(this.buffers.cellCounts, 0, new Uint32Array(this.gridResX * this.gridResY));

    const commandEncoder = this.device.createCommandEncoder();

    const hashCountPass = commandEncoder.beginComputePass();
    hashCountPass.setPipeline(this.pipelines.hashCount);
    hashCountPass.setBindGroup(0, this.bindGroups.hashCount);
    hashCountPass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    hashCountPass.end();

    this.device.queue.submit([commandEncoder.finish()]);

    const cellCounts = await this.readCellCounts();
    this.computePrefixSum(cellCounts);

    this.device.queue.writeBuffer(this.buffers.cellStart, 0, this.cellStartData);
    this.device.queue.writeBuffer(this.buffers.cellEnd, 0, this.cellEndData);

    const positions = await this.readPositions(this.pingPongIndex);
    this.fillParticleIndices(positions);

    const commandEncoder2 = this.device.createCommandEncoder();

    const densityPressurePass = commandEncoder2.beginComputePass();
    densityPressurePass.setPipeline(this.pipelines.densityPressure);
    densityPressurePass.setBindGroup(0, this.bindGroups.densityPressure);
    densityPressurePass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    densityPressurePass.end();

    const forceIntegratePass = commandEncoder2.beginComputePass();
    forceIntegratePass.setPipeline(this.pipelines.forceIntegrate);
    forceIntegratePass.setBindGroup(0, this.bindGroups.forceIntegrate);
    forceIntegratePass.dispatchWorkgroups(Math.ceil(this.particleCount / 256));
    forceIntegratePass.end();

    const heightFieldPass = commandEncoder2.beginComputePass();
    heightFieldPass.setPipeline(this.pipelines.heightField);
    heightFieldPass.setBindGroup(0, this.bindGroups.heightField);
    heightFieldPass.dispatchWorkgroups(
      Math.ceil(this.heightFieldRes / 16),
      Math.ceil(this.heightFieldRes / 16)
    );
    heightFieldPass.end();

    const computeNormalsPass = commandEncoder2.beginComputePass();
    computeNormalsPass.setPipeline(this.pipelines.computeNormals);
    computeNormalsPass.setBindGroup(0, this.bindGroups.computeNormals);
    computeNormalsPass.dispatchWorkgroups(
      Math.ceil(this.heightFieldRes / 16),
      Math.ceil(this.heightFieldRes / 16)
    );
    computeNormalsPass.end();

    this.device.queue.submit([commandEncoder2.finish()]);

    this.pingPongIndex = 1 - this.pingPongIndex;

    this.bindGroups.hashCount = this.createHashCountBindGroup();
    this.bindGroups.densityPressure = this.createDensityPressureBindGroup();
    this.bindGroups.forceIntegrate = this.createForceIntegrateBindGroup();
    this.bindGroups.heightField = this.createHeightFieldBindGroup();
    this.bindGroups.computeNormals = this.createComputeNormalsBindGroup();
  }

  async getPositions(): Promise<Float32Array> {
    return this.readPositions(this.pingPongIndex);
  }

  async getHeightField(): Promise<HeightField> {
    const heightFieldSize = this.heightFieldRes * this.heightFieldRes;

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
  }

  getDevice(): GPUDevice {
    return this.device;
  }

  getAdapter(): GPUAdapter {
    return this.adapter;
  }
}
