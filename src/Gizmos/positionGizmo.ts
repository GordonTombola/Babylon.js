import { Logger } from "../Misc/logger";
import { Observable, Observer } from "../Misc/observable";
import { Nullable } from "../types";
import { Vector3 } from "../Maths/math.vector";
import { Color3 } from '../Maths/math.color';
import { AbstractMesh } from "../Meshes/abstractMesh";
import { Node } from "../node";
import { Mesh } from "../Meshes/mesh";
import { Gizmo } from "./gizmo";
import { AxisDragGizmo } from "./axisDragGizmo";
import { PlaneDragGizmo } from "./planeDragGizmo";
import { UtilityLayerRenderer } from "../Rendering/utilityLayerRenderer";
import { PointerEventTypes, PointerInfo } from "../Events/pointerEvents";
import { LinesMesh } from "../Meshes/linesMesh";
/**
 * Gizmo that enables dragging a mesh along 3 axis
 */
export class PositionGizmo extends Gizmo {
    /**
     * Internal gizmo used for interactions on the x axis
     */
    public xGizmo: AxisDragGizmo;
    /**
     * Internal gizmo used for interactions on the y axis
     */
    public yGizmo: AxisDragGizmo;
    /**
     * Internal gizmo used for interactions on the z axis
     */
    public zGizmo: AxisDragGizmo;
    /**
     * Internal gizmo used for interactions on the yz plane
     */
    public xPlaneGizmo: PlaneDragGizmo;
    /**
     * Internal gizmo used for interactions on the xz plane
     */
    public yPlaneGizmo: PlaneDragGizmo;
    /**
     * Internal gizmo used for interactions on the xy plane
     */
    public zPlaneGizmo: PlaneDragGizmo;

    /**
     * private variables
     */
    private _meshAttached: Nullable<AbstractMesh> = null;
    private _nodeAttached: Nullable<Node> = null;
    private _snapDistance: number;
    private _observables: Nullable<Observer<PointerInfo>>[] = [];

    /** Gizmo state variables used for UI behavior */
    private dragging = false;
    /** Node Caching for quick lookup */
    private gizmoAxisCache: Map<Mesh, any> = new Map();

    /** Fires an event when any of it's sub gizmos are dragged */
    public onDragStartObservable = new Observable();
    /** Fires an event when any of it's sub gizmos are released from dragging */
    public onDragEndObservable = new Observable();

    /**
     * If set to true, planar drag is enabled
     */
    private _planarGizmoEnabled = false;

    public get attachedMesh() {
        return this._meshAttached;
    }
    public set attachedMesh(mesh: Nullable<AbstractMesh>) {
        this._meshAttached = mesh;
        this._nodeAttached = mesh;
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo.isEnabled) {
                gizmo.attachedMesh = mesh;
            }
            else {
                gizmo.attachedMesh = null;
            }
        });
    }

    public get attachedNode() {
        return this._nodeAttached;
    }
    public set attachedNode(node: Nullable<Node>) {
        this._meshAttached = null;
        this._nodeAttached = null;
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo.isEnabled) {
                gizmo.attachedNode = node;
            }
            else {
                gizmo.attachedNode = null;
            }
        });
    }

    /**
     * True when the mouse pointer is hovering a gizmo mesh
     */
    public get isHovered() {
        var hovered = false;
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            hovered = hovered || gizmo.isHovered;
        });
        return hovered;
    }

    /**
     * Creates a PositionGizmo
     * @param gizmoLayer The utility layer the gizmo will be added to
      @param thickness display gizmo axis thickness
     */
    constructor(gizmoLayer: UtilityLayerRenderer = UtilityLayerRenderer.DefaultUtilityLayer, thickness: number = 1) {
        super(gizmoLayer);
        this.xGizmo = new AxisDragGizmo(new Vector3(1, 0, 0), Color3.Red().scale(0.5), gizmoLayer, this, thickness);
        this.yGizmo = new AxisDragGizmo(new Vector3(0, 1, 0), Color3.Green().scale(0.5), gizmoLayer, this, thickness);
        this.zGizmo = new AxisDragGizmo(new Vector3(0, 0, 1), Color3.Blue().scale(0.5), gizmoLayer, this, thickness);

        this.xPlaneGizmo = new PlaneDragGizmo(new Vector3(1, 0, 0), Color3.Red().scale(0.5), this.gizmoLayer, this);
        this.yPlaneGizmo = new PlaneDragGizmo(new Vector3(0, 1, 0), Color3.Green().scale(0.5), this.gizmoLayer, this);
        this.zPlaneGizmo = new PlaneDragGizmo(new Vector3(0, 0, 1), Color3.Blue().scale(0.5), this.gizmoLayer, this);
        // Relay drag events
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            gizmo.dragBehavior.onDragStartObservable.add(() => {
                this.onDragStartObservable.notifyObservers({});
            });
            gizmo.dragBehavior.onDragEndObservable.add(() => {
                this.onDragEndObservable.notifyObservers({});
            });
        });

        this.attachedMesh = null;
        this.subscribeToPointerObserver();
    }

    /**
     * If the planar drag gizmo is enabled
     * setting this will enable/disable XY, XZ and YZ planes regardless of individual gizmo settings.
     */
    public set planarGizmoEnabled(value: boolean) {
        this._planarGizmoEnabled = value;
        [this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo) {
                gizmo.isEnabled = value;
                if (value) {
                    if (gizmo.attachedMesh) {
                        gizmo.attachedMesh = this.attachedMesh;
                    } else {
                        gizmo.attachedNode = this.attachedNode;
                    }

                }
            }
        }, this);
    }
    public get planarGizmoEnabled(): boolean {
        return this._planarGizmoEnabled;
    }

    public set updateGizmoRotationToMatchAttachedMesh(value: boolean) {
        this._updateGizmoRotationToMatchAttachedMesh = value;
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo) {
                gizmo.updateGizmoRotationToMatchAttachedMesh = value;
            }
        });
    }
    public get updateGizmoRotationToMatchAttachedMesh() {
        return this._updateGizmoRotationToMatchAttachedMesh;
    }

    /**
     * Drag distance in babylon units that the gizmo will snap to when dragged (Default: 0)
     */
    public set snapDistance(value: number) {
        this._snapDistance = value;
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo) {
                gizmo.snapDistance = value;
            }
        });
    }
    public get snapDistance() {
        return this._snapDistance;
    }

    /**
     * Ratio for the scale of the gizmo (Default: 1)
     */
    public set scaleRatio(value: number) {
        this._scaleRatio = value;
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo) {
                gizmo.scaleRatio = value;
            }
        });
    }
    public get scaleRatio() {
        return this._scaleRatio;
    }

    /**
     * Builds Gizmo Axis Cache to enable features such as hover state preservation and graying out other axis during manipulation
     * @param mesh Axis gizmo mesh
      @param cache display gizmo axis thickness
     */
    public addToAxisCache(mesh: Mesh, cache: any) {
        this.gizmoAxisCache.set(mesh, cache);
    }

    /**
     * Subscribes to pointer up, down, and hover events. Used for responsive gizmos.
     */
    public subscribeToPointerObserver(): void {
        const pointerObserver = this.gizmoLayer.utilityLayerScene.onPointerObservable.add((pointerInfo) => {
            if (pointerInfo.pickInfo) {
                // On Hover Logic
                if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
                    if (this.dragging) { return; }
                    this.gizmoAxisCache.forEach((statusMap, parentMesh) => {
                        const isHovered = pointerInfo.pickInfo && (parentMesh.getChildMeshes().indexOf((pointerInfo.pickInfo.pickedMesh as Mesh)) != -1);
                        const material = isHovered || statusMap.active ? statusMap.hoverMaterial : statusMap.material;
                        parentMesh.getChildMeshes().forEach((m) => {
                            if (m.name !== 'ignore') {
                                m.material = material;
                                if ((m as LinesMesh).color) {
                                    (m as LinesMesh).color = material.diffuseColor;
                                }
                            }
                        });
                    });
                }

                // On Mouse Down
                if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
                    // If user Clicked Gizmo
                    if (this.gizmoAxisCache.has(pointerInfo.pickInfo.pickedMesh?.parent as Mesh)) {
                        this.dragging = true;
                        const statusMap = this.gizmoAxisCache.get(pointerInfo.pickInfo.pickedMesh?.parent as Mesh);
                        statusMap!.active = true;
                        this.gizmoAxisCache.forEach((statusMap, parentMesh) => {
                            const isHovered = pointerInfo.pickInfo && (parentMesh.getChildMeshes().indexOf((pointerInfo.pickInfo.pickedMesh as Mesh)) != -1);
                            const material = isHovered || statusMap.active ? statusMap.hoverMaterial : statusMap.disableMaterial;
                            parentMesh.getChildMeshes().forEach((m) => {
                                if (m.name !== 'ignore') {
                                    m.material = material;
                                    if ((m as LinesMesh).color) {
                                        (m as LinesMesh).color = material.diffuseColor;
                                    }
                                }
                            });
                        });
                    }
                }

                // On Mouse Up
                if (pointerInfo.type === PointerEventTypes.POINTERUP) {
                    this.gizmoAxisCache.forEach((statusMap, parentMesh) => {
                        statusMap.active = false;
                        this.dragging = false;
                        parentMesh.getChildMeshes().forEach((m) => {
                            if (m.name !== 'ignore') {
                                m.material = statusMap.material;
                                if ((m as LinesMesh).color) {
                                    (m as LinesMesh).color = statusMap.material.diffuseColor;
                                }
                            }
                        });
                    });
                }
            }
        });

        this._observables = [pointerObserver];
    }

    /**
     * Disposes of the gizmo
     */
    public dispose() {
        [this.xGizmo, this.yGizmo, this.zGizmo, this.xPlaneGizmo, this.yPlaneGizmo, this.zPlaneGizmo].forEach((gizmo) => {
            if (gizmo) {
                gizmo.dispose();
            }
        });
        this._observables.forEach((obs) => {
            this.gizmoLayer.utilityLayerScene.onPointerObservable.remove(obs);
        });
        this.onDragStartObservable.clear();
        this.onDragEndObservable.clear();
    }

    /**
     * CustomMeshes are not supported by this gizmo
     * @param mesh The mesh to replace the default mesh of the gizmo
     */
    public setCustomMesh(mesh: Mesh) {
        Logger.Error("Custom meshes are not supported on this gizmo, please set the custom meshes on the gizmos contained within this one (gizmo.xGizmo, gizmo.yGizmo, gizmo.zGizmo,gizmo.xPlaneGizmo, gizmo.yPlaneGizmo, gizmo.zPlaneGizmo)");
    }
}
