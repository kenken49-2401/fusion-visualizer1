import { ArrowHelper, Box3, CylinderGeometry, Group, Line, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { ModelScene } from './scene';
import type { FixingMarker } from './schema';
export class FixingView {
    private group = new Group();
    private labels: {
        element: HTMLSpanElement;
        position: Vector3;
    }[] = [];
    private overlay = document.createElement('div');
    private observer: ResizeObserver;
    constructor(private scene: ModelScene, private viewport: HTMLElement, private span: number) {
        this.overlay.className = 'fixing-overlay';
        viewport.append(this.overlay);
        scene.scene.add(this.group);
        scene.controls.addEventListener('change', this.update);
        this.observer = new ResizeObserver(this.update);
        this.observer.observe(viewport);
    }
    set(markers: FixingMarker[]) {
        this.clear();
        for (const marker of markers) {
            const position = new Vector3(...marker.position).multiplyScalar(.001), direction = new Vector3(...marker.direction).normalize();
            const size = Math.max(this.span * .07, .06), radius = Math.max(this.span * .0018, .002);
            const material = new MeshBasicMaterial({ color: '#e33732', depthTest: false, depthWrite: false });
            if (marker.type === 'screw') {
                const length = marker.lengthMM * .001, shaft = new Mesh(new CylinderGeometry(radius, radius * .65, length, 12), material);
                shaft.position.copy(position).addScaledVector(direction, length / 2);
                shaft.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
                this.group.add(shaft);
                const head = new Mesh(new CylinderGeometry(radius * 2, radius * 2, radius * .8, 16), material.clone());
                head.position.copy(position);
                head.quaternion.copy(shaft.quaternion);
                this.group.add(head);
            }
            else {
                const point = new Mesh(new SphereGeometry(radius * 2, 12, 8), material);
                point.position.copy(position);
                this.group.add(point);
            }
            if (marker.type !== 'point') {
                const arrow = new ArrowHelper(direction, position.clone().addScaledVector(direction, -size), size, 0xe33732, size * .2, size * .12);
                for (const part of [arrow.line, arrow.cone]) {
                    const mats = Array.isArray(part.material) ? part.material : [part.material];
                    mats.forEach(m => { m.depthTest = false; m.depthWrite = false; });
                }
                this.group.add(arrow);
            }
            const element = document.createElement('span');
            element.className = 'fixing-label';
            element.textContent = marker.label || '固定位置';
            element.dataset.markerId = marker.id;
            this.overlay.append(element);
            this.labels.push({ element, position });
        }
        this.group.traverse(object => { object.renderOrder = 20; });
        this.scene.requestRender();
        this.update();
    }
    readonly update = () => {
        const { width, height } = this.viewport.getBoundingClientRect();
        for (const { element, position } of this.labels) {
            const point = position.clone().project(this.scene.camera);
            element.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.15 || Math.abs(point.y) > 1.15;
            const half = Math.min(90, width / 2);
            element.style.left = `${Math.max(half, Math.min(width - half, (point.x + 1) * width / 2))}px`;
            element.style.top = `${Math.max(20, Math.min(height - 25, (1 - point.y) * height / 2 - 22))}px`;
        }
    };
    focus(marker: FixingMarker) { const p = new Vector3(...marker.position).multiplyScalar(.001), size = Math.max(this.span * .12, .1); this.scene.focus(new Box3().setFromCenterAndSize(p, new Vector3(size, size, size))); this.update(); }
    private clear() { this.group.traverse(o => { if (o instanceof Mesh || o instanceof Line) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    } }); this.group.clear(); this.overlay.replaceChildren(); this.labels = []; }
    dispose() { this.clear(); this.observer.disconnect(); this.scene.controls.removeEventListener('change', this.update); this.scene.scene.remove(this.group); this.overlay.remove(); }
}
