import * as THREE from 'three';

/*
 * Photo mode camera: it orbits a pivot placed in front of the scene's own camera (on whatever is
 * at the centre of the view when photo mode opens) and rides along with that camera, so a moving
 * ship stays framed. Expressed in the scene camera's local space; pure apart from the outputs.
 */

export interface PhotoView {
  /** Orbit angles around the pivot (rad): yaw about the camera's up, pitch about its right. */
  readonly yaw: number;
  readonly pitch: number;
  /** Distance factor (1 = where the scene camera is). */
  readonly zoom: number;
}

export const PHOTO_HOME: PhotoView = { yaw: 0, pitch: 0, zoom: 1 };
export const PHOTO_PITCH_LIMIT = 1.45;
export const PHOTO_ZOOM_MIN = 0.15;
export const PHOTO_ZOOM_MAX = 8;
/** Pivot distance range (scene units) and the fallback when nothing is under the view centre. */
export const PIVOT_MIN = 2;
export const PIVOT_MAX = 3000;
export const PIVOT_FALLBACK = 60;

/** A view moved by a drag (pixels) and a wheel step count (positive = out), clamped. Pure. */
export function adjustPhotoView(
  view: PhotoView,
  dxPx: number,
  dyPx: number,
  wheelSteps = 0,
): PhotoView {
  return {
    yaw: view.yaw - dxPx * 0.006,
    pitch: THREE.MathUtils.clamp(view.pitch - dyPx * 0.005, -PHOTO_PITCH_LIMIT, PHOTO_PITCH_LIMIT),
    zoom: THREE.MathUtils.clamp(view.zoom * 1.1 ** wheelSteps, PHOTO_ZOOM_MIN, PHOTO_ZOOM_MAX),
  };
}

const euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Photo camera pose in the scene camera's local frame (looking down −Z, pivot at 0,0,−pivotDist):
 * on a sphere around the pivot, looking at it.
 */
export function photoLocalPose(
  pivotDist: number,
  view: PhotoView,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): void {
  euler.set(view.pitch, view.yaw, 0);
  outQuat.setFromEuler(euler);
  outPos
    .set(0, 0, pivotDist * view.zoom)
    .applyQuaternion(outQuat)
    .add(new THREE.Vector3(0, 0, -pivotDist));
}

/** Clamps a raycast hit distance into a usable pivot distance. */
export function pivotDistance(hitDistance: number | null): number {
  if (hitDistance === null || !Number.isFinite(hitDistance)) return PIVOT_FALLBACK;
  return THREE.MathUtils.clamp(hitDistance, PIVOT_MIN, PIVOT_MAX);
}
