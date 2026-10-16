import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { initialFlightState, type FlightState } from '../src/flight/flightModel';
import {
  FlightTrack,
  interpolateState,
  ReplayPlayer,
  TRACK_BASE_INTERVAL_S,
  TRACK_MAX_SAMPLES,
} from '../src/flight/flightTrack';
import {
  adjustPhotoView,
  PHOTO_HOME,
  PHOTO_PITCH_LIMIT,
  PHOTO_ZOOM_MAX,
  photoLocalPose,
  pivotDistance,
  PIVOT_FALLBACK,
  PIVOT_MAX,
} from '../src/game/photoCamera';
import { photoFileName } from '../src/app/photoStore';
import { EARTH_MU_M3S2, EARTH_RADIUS_M } from '../src/simulation/constants';

const R = EARTH_RADIUS_M + 400_000;
const V = Math.sqrt(EARTH_MU_M3S2 / R);
const N = V / R;

/** A ship on a circular orbit at time t. */
function onOrbit(t: number, extra: Partial<FlightState> = {}): FlightState {
  const a = N * t;
  return {
    ...initialFlightState(
      [R * Math.cos(a), R * Math.sin(a)],
      [-V * Math.sin(a), V * Math.cos(a)],
      1000,
      t,
    ),
    ...extra,
  };
}

describe('flight replay track', () => {
  it('interpolates along the orbital arc, not the chord', () => {
    const a = onOrbit(0);
    const b = onOrbit(900); // about a sixth of an orbit apart
    const mid = interpolateState(a, b, 0.5);
    // The chord would dip ~900 km; the arc stays on the orbit and close to the true position.
    expect(Math.abs(Math.hypot(...mid.r) - R)).toBeLessThan(1);
    const truth = onOrbit(450).r;
    expect(Math.hypot(mid.r[0] - truth[0], mid.r[1] - truth[1])).toBeLessThan(20_000);
    expect(Math.hypot(...mid.v)).toBeCloseTo(V, -2);
    expect(mid.tS).toBeCloseTo(450);
    expect(interpolateState(a, b, 0).r).toEqual(a.r);
    const end = interpolateState(a, b, 1);
    expect(end.r[0]).toBeCloseTo(b.r[0], 3);
    expect(end.r[1]).toBeCloseTo(b.r[1], 3);
  });

  it('blends attitude the short way and steps across discrete changes', () => {
    const a = onOrbit(0, { pitchDeg: 170 });
    const b = onOrbit(10, { pitchDeg: -170 });
    expect(Math.abs(interpolateState(a, b, 0.5).pitchDeg)).toBeCloseTo(180);
    const landed = onOrbit(10, { phase: 'landed' });
    expect(interpolateState(a, landed, 0.5)).toBe(a);
    expect(interpolateState(a, landed, 1)).toBe(landed);
  });

  it('records at its interval, on phase changes and with cuts', () => {
    const track = new FlightTrack();
    for (let i = 0; i < 10; i++) track.record(0.1, onOrbit(i));
    expect(track.samples).toHaveLength(Math.ceil((10 * 0.1) / TRACK_BASE_INTERVAL_S));
    track.record(0.01, onOrbit(11, { phase: 'landed' }));
    expect(track.samples.at(-1)?.s.phase).toBe('landed');
    track.record(0.5, null);
    track.record(0.01, onOrbit(500));
    expect(track.samples.at(-1)?.cut).toBe(true);
    // Across a cut the replay holds the earlier state instead of sweeping across the gap.
    const before = track.samples.at(-2)!;
    const after = track.samples.at(-1)!;
    expect(track.stateAt((before.t + after.t) / 2)).toBe(before.s);
  });

  it('stays bounded on long flights by thinning itself out', () => {
    const track = new FlightTrack();
    for (let i = 0; i < TRACK_MAX_SAMPLES * 5; i++) track.record(TRACK_BASE_INTERVAL_S, onOrbit(i));
    expect(track.samples.length).toBeLessThanOrEqual(TRACK_MAX_SAMPLES);
    expect(track.intervalS).toBeGreaterThan(TRACK_BASE_INTERVAL_S);
    expect(track.samples.at(-1)!.s.tS).toBeGreaterThan(TRACK_MAX_SAMPLES * 5 - 10);
    track.clear();
    expect(track.samples).toHaveLength(0);
    expect(track.stateAt(1)).toBeNull();
  });

  it('plays back, seeks, changes speed and plays again from the end', () => {
    const track = new FlightTrack();
    const player = new ReplayPlayer(track);
    expect(player.availability().ok).toBe(false);
    expect(player.start()).toBe(false);
    for (let i = 0; i <= 100; i++) track.record(0.2, onOrbit(i * 10));
    expect(track.duration).toBeCloseTo(20);
    let notified = 0;
    player.subscribe(() => notified++);
    expect(player.start(4)).toBe(true);
    expect(player.state?.tS).toBe(0);
    player.update(1);
    expect(player.getSnapshot()?.t).toBeCloseTo(4);
    expect(player.state?.tS).toBeCloseTo(200);
    player.setSpeed(16);
    player.update(10);
    expect(player.getSnapshot()).toMatchObject({ playing: false, t: track.duration });
    player.togglePlay();
    expect(player.getSnapshot()).toMatchObject({ playing: true, t: 0 });
    player.seek(999);
    expect(player.getSnapshot()?.t).toBe(track.duration);
    player.seek(-5);
    expect(player.getSnapshot()?.t).toBe(0);
    expect(notified).toBeGreaterThan(3);
    player.stop();
    expect(player.active).toBe(false);
    expect(player.state).toBeNull();
  });
});

describe('photo mode camera', () => {
  it('starts where the scene camera is and orbits the pivot', () => {
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    photoLocalPose(50, PHOTO_HOME, pos, q);
    expect(pos.length()).toBeCloseTo(0);
    expect(q.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
    // Half way round: on the far side of the pivot, looking back at it.
    photoLocalPose(50, { yaw: Math.PI, pitch: 0, zoom: 1 }, pos, q);
    expect(pos.z).toBeCloseTo(-100);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    expect(look.z).toBeCloseTo(1);
    // Zooming out doubles the distance to the pivot.
    photoLocalPose(50, { yaw: 0, pitch: 0, zoom: 2 }, pos, q);
    expect(pos.distanceTo(new THREE.Vector3(0, 0, -50))).toBeCloseTo(100);
  });

  it('clamps the view and the pivot distance', () => {
    const v = adjustPhotoView(PHOTO_HOME, 0, -100_000, 100);
    expect(v.pitch).toBe(PHOTO_PITCH_LIMIT);
    expect(v.zoom).toBe(PHOTO_ZOOM_MAX);
    expect(pivotDistance(null)).toBe(PIVOT_FALLBACK);
    expect(pivotDistance(1e9)).toBe(PIVOT_MAX);
    expect(pivotDistance(120)).toBe(120);
  });

  it('names photos by location and time', () => {
    expect(photoFileName('launch-pad', new Date(2026, 9, 16, 7, 5, 9))).toBe(
      'rocketworks-launch-pad-2026-10-16-07-05-09.png',
    );
  });
});
