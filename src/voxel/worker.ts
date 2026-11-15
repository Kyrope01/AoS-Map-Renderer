import { parseKv6, SerializedKv6Grid } from './kv6Parser';
import { buildVoxelGeometryData, BuiltVoxelMeshData } from './mesher';
import { VoxelFormat, VoxelParseError } from './types';
import { parseVxl, SerializedVxlGrid } from './vxlParser';
import { buildVoxelShadowData, VoxelShadowAtlasData } from '../renderer/voxelShadows';

export interface VoxelWorkerRequest {
  id: number;
  format: VoxelFormat;
  buffer: ArrayBuffer;
  maxTextureSize: number;
}

export interface VoxelWorkerSuccess {
  id: number;
  ok: true;
  grid: SerializedKv6Grid | SerializedVxlGrid;
  mesh: BuiltVoxelMeshData;
  shadowAtlas: VoxelShadowAtlasData | null;
  shadowError: string | null;
  parseMs: number;
  meshMs: number;
}

export interface VoxelWorkerFailure {
  id: number;
  ok: false;
  isParseError: boolean;
  error: string;
}

export type VoxelWorkerResponse = VoxelWorkerSuccess | VoxelWorkerFailure;

self.onmessage = (event: MessageEvent<VoxelWorkerRequest>) => {
  const { id, format, buffer, maxTextureSize } = event.data;

  try {
    const tParse0 = performance.now();
    const grid = format === 'kv6' ? parseKv6(buffer) : parseVxl(buffer);
    const parseMs = performance.now() - tParse0;

    const tMesh0 = performance.now();
    const mesh = buildVoxelGeometryData(grid);
    const meshMs = performance.now() - tMesh0;

    let shadowAtlas: VoxelShadowAtlasData | null = null;
    let shadowError: string | null = null;
    try {
      shadowAtlas = buildVoxelShadowData(grid, maxTextureSize);
    } catch (err) {
      shadowError =
        err instanceof Error
          ? err.message
          : 'Could not create voxel-light shadows. Lights will be unshadowed.';
    }

    const serializedGrid = grid.toSerialized();
    const transferSet = new Set<ArrayBuffer>([
      mesh.positions.buffer as ArrayBuffer,
      mesh.normals.buffer as ArrayBuffer,
      mesh.colors.buffer as ArrayBuffer,
      mesh.ao.buffer as ArrayBuffer,
      mesh.indices.buffer as ArrayBuffer,
    ]);

    if (serializedGrid.format === 'kv6') {
      if (serializedGrid.dense) transferSet.add(serializedGrid.dense.buffer as ArrayBuffer);
      if (serializedGrid.sparseKeys) transferSet.add(serializedGrid.sparseKeys.buffer as ArrayBuffer);
      if (serializedGrid.sparseVals) transferSet.add(serializedGrid.sparseVals.buffer as ArrayBuffer);
    } else {
      transferSet.add(serializedGrid.solidLo.buffer as ArrayBuffer);
      transferSet.add(serializedGrid.solidHi.buffer as ArrayBuffer);
      transferSet.add(serializedGrid.colStart.buffer as ArrayBuffer);
      transferSet.add(serializedGrid.colCount.buffer as ArrayBuffer);
      transferSet.add(serializedGrid.surfGy.buffer as ArrayBuffer);
      transferSet.add(serializedGrid.surfColor.buffer as ArrayBuffer);
    }

    if (shadowAtlas) {
      transferSet.add(shadowAtlas.data.buffer as ArrayBuffer);
    }

    const response: VoxelWorkerSuccess = {
      id,
      ok: true,
      grid: serializedGrid,
      mesh,
      shadowAtlas,
      shadowError,
      parseMs,
      meshMs,
    };

    self.postMessage(response, { transfer: Array.from(transferSet) });
  } catch (err) {
    const response: VoxelWorkerFailure = {
      id,
      ok: false,
      isParseError: err instanceof VoxelParseError,
      error:
        err instanceof Error
          ? err.message
          : 'Failed to parse voxel file.',
    };
    self.postMessage(response);
  }
};
