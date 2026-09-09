import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type ViewName = 'overview' | 'edge' | 'disk' | 'top';
export interface CameraPose { radius: number; polar: number; azimuth: number; target: [number, number, number] }
interface Flight { from: CameraPose; to: CameraPose; elapsed: number; duration: number }

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const spherical = new Spherical();
const offset = new Vector3();

export function presetPose(view: ViewName, aspect: number): CameraPose {
  const portrait = aspect < 0.8;
  const distance = portrait ? 50 : 27;
  const presets: Record<ViewName, CameraPose> = {
    overview: { radius: distance, polar: 1.31, azimuth: 0.32, target: [0, 0, 0] },
    edge: { radius: distance * 0.90, polar: 1.495, azimuth: 0.62, target: [0, 0, 0] },
    disk: { radius: portrait ? 23 : 14.5, polar: 1.00, azimuth: 0.84, target: [1.9, 0, 0] },
    top: { radius: portrait ? 48 : 24, polar: 0.20, azimuth: 0.32, target: [0, 0, 0] },
  };
  return presets[view];
}

export class CameraRig {
  readonly camera = new PerspectiveCamera(45, 1, 0.1, 1000);
  readonly controls: OrbitControls;
  cruising = false;
  view: ViewName | 'free' = 'overview';
  private flight: Flight | null = null;
  private cruisePhase = 0;
  private cruiseBase: CameraPose | null = null;
  private zoomDestination: number | null = null;
  private interacted = false;
  private readonly events = new AbortController();

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onChange: () => void) {
    this.camera.aspect = innerWidth / innerHeight;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.rotateSpeed = 0.48;
    this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = 14.5;
    this.controls.maxDistance = 140;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.045;
    this.controls.addEventListener('start', this.takeOver);
    this.applyPose(presetPose('overview', this.camera.aspect));
    // Wheel input owns a smooth distance target; touch pinch remains in OrbitControls.
    canvas.addEventListener('wheel', this.wheel, { capture: true, passive: false, signal: this.events.signal });
    canvas.addEventListener('pointerdown', this.pointerDown, { capture: true, signal: this.events.signal });
  }

  private pointerDown = () => { this.interacted = true; this.takeOver(); };

  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    this.interacted = true;
    this.stopFlight();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    this.zoom(Math.exp(MathUtils.clamp(delta, -350, 350) * 0.0011));
  };

  private stopFlight() {
    this.flight = null;
    this.cruising = false;
    this.cruiseBase = null;
    this.view = 'free';
    this.onChange();
  }

  takeOver = () => { this.stopFlight(); this.zoomDestination = null; };

  pose(): CameraPose {
    offset.copy(this.camera.position).sub(this.controls.target);
    spherical.setFromVector3(offset);
    return { radius: spherical.radius, polar: spherical.phi, azimuth: spherical.theta, target: this.controls.target.toArray() };
  }

  applyPose(pose: CameraPose) {
    this.controls.target.fromArray(pose.target);
    spherical.set(MathUtils.clamp(pose.radius, 14.5, 140), MathUtils.clamp(pose.polar, 0.08, Math.PI / 2 - 0.045), pose.azimuth);
    this.camera.position.setFromSpherical(spherical).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
  }

  private clearInertia() {
    const position = this.camera.position.clone();
    const target = this.controls.target.clone();
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.camera.position.copy(position);
    this.controls.target.copy(target);
  }

  goTo(view: ViewName, immediate = false) {
    this.clearInertia();
    this.cruising = false;
    this.zoomDestination = null;
    const to = presetPose(view, this.camera.aspect);
    const from = this.pose();
    to.azimuth = from.azimuth + MathUtils.euclideanModulo(to.azimuth - from.azimuth + Math.PI, Math.PI * 2) - Math.PI;
    this.flight = immediate ? null : { from, to, elapsed: 0, duration: 2.4 };
    if (immediate) this.applyPose(to);
    this.view = view;
    this.onChange();
  }

  focusDisk(radius: number, angle: number) {
    this.goTo('disk');
    if (this.flight) {
      this.flight.to.azimuth = this.flight.from.azimuth + MathUtils.euclideanModulo(Math.PI / 2 - angle - this.flight.from.azimuth + Math.PI, 2 * Math.PI) - Math.PI;
      const focusRadius = Math.min(radius * 0.35, 2.3);
      this.flight.to.target = [Math.cos(angle) * focusRadius, 0, Math.sin(angle) * focusRadius];
    }
  }

  zoom(factor: number) {
    this.stopFlight();
    this.zoomDestination = MathUtils.clamp((this.zoomDestination ?? this.pose().radius) * factor, 14.5, 140);
  }

  toggleCruise() {
    if (this.cruising) { this.takeOver(); return; }
    this.clearInertia();
    this.flight = null;
    this.zoomDestination = null;
    this.cruising = true;
    this.cruiseBase = this.pose();
    this.cruisePhase = 0;
    this.view = 'free';
    this.onChange();
  }

  update(dt: number, paused: boolean) {
    if (this.flight) {
      const flight = this.flight;
      flight.elapsed = Math.min(flight.duration, flight.elapsed + dt);
      const t = smooth(flight.elapsed / flight.duration);
      spherical.set(
        Math.exp(MathUtils.lerp(Math.log(flight.from.radius), Math.log(flight.to.radius), t)),
        MathUtils.lerp(flight.from.polar, flight.to.polar, t),
        MathUtils.lerp(flight.from.azimuth, flight.to.azimuth, t),
      );
      this.controls.target.set(
        MathUtils.lerp(flight.from.target[0], flight.to.target[0], t),
        MathUtils.lerp(flight.from.target[1], flight.to.target[1], t),
        MathUtils.lerp(flight.from.target[2], flight.to.target[2], t),
      );
      this.camera.position.setFromSpherical(spherical).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      if (flight.elapsed >= flight.duration) this.flight = null;
    } else if (this.cruising && this.cruiseBase) {
      if (!paused) this.cruisePhase += dt;
      const p = this.cruisePhase;
      const ramp = 1 - Math.exp(-p * 0.6);
      const base = this.cruiseBase;
      spherical.set(MathUtils.clamp(base.radius * (1 + Math.sin(p * 0.07) * 0.10 * ramp),14.5,140),
        MathUtils.clamp(base.polar + Math.sin(p * 0.11) * 0.17 * ramp, 0.08, 1.49),
        base.azimuth + (p - (1 - Math.exp(-p * 0.6)) / 0.6) * 0.035);
      this.camera.position.setFromSpherical(spherical).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
    } else if (this.zoomDestination !== null) {
      offset.copy(this.camera.position).sub(this.controls.target);
      const next = MathUtils.damp(offset.length(), this.zoomDestination, 10, dt);
      offset.setLength(next);
      this.camera.position.copy(this.controls.target).add(offset);
      if (Math.abs(next - this.zoomDestination) < 0.0001) this.zoomDestination = null;
    } else this.controls.update(dt);
    this.camera.updateMatrixWorld();
  }

  resize(width: number, height: number) {
    const oldPortrait = this.camera.aspect < 0.8;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.interacted && this.view === 'overview' && oldPortrait !== (width / height < 0.8)) this.goTo('overview');
  }

  get transitioning() { return this.flight !== null || this.zoomDestination !== null; }
  dispose() { this.events.abort(); this.controls.removeEventListener('start', this.takeOver); this.controls.dispose(); }
}
