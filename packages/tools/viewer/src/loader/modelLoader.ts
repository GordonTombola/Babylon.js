import { GLTFFileLoader, GLTFLoaderAnimationStartMode } from "loaders/glTF/glTFFileLoader";
import { ISceneLoaderPlugin, ISceneLoaderPluginAsync, SceneLoader } from "core/Loading/sceneLoader";
import { Tools } from "core/Misc/tools";

import { Tags } from "core/Misc/tags";

import { ConfigurationContainer } from "../configuration/configurationContainer";
import { IModelConfiguration } from "../configuration/interfaces/modelConfiguration";
import { ObservablesManager } from "../managers/observablesManager";
import { ModelState, ViewerModel } from "../model/viewerModel";
import { getLoaderPluginByName, ILoaderPlugin } from "./plugins/index";

/**
 * An instance of the class is in charge of loading the model correctly.
 * This class will continously be expended with tasks required from the specific loaders Babylon has.
 *
 * A Model loader is unique per (Abstract)Viewer. It is being generated by the viewer
 */
export class ModelLoader {
    private _loadId: number;
    private _disposed = false;

    private _loaders: Array<ISceneLoaderPlugin | ISceneLoaderPluginAsync>;

    private _plugins: Array<ILoaderPlugin>;

    private _baseUrl: string;

    public get baseUrl(): string {
        return this._baseUrl;
    }

    /**
     * Create a new Model loader
     * @param _viewer the viewer using this model loader
     * @param _observablesManager
     * @param _configurationContainer
     */
    constructor(private _observablesManager: ObservablesManager, private _configurationContainer?: ConfigurationContainer) {
        this._loaders = [];
        this._loadId = 0;
        this._plugins = [];
    }

    /**
     * Adds a new plugin to the loader process.
     *
     * @param plugin the plugin name or the plugin itself
     */
    public addPlugin(plugin: ILoaderPlugin | string) {
        let actualPlugin: ILoaderPlugin = {};
        if (typeof plugin === "string") {
            const loadedPlugin = getLoaderPluginByName(plugin);
            if (loadedPlugin) {
                actualPlugin = loadedPlugin;
            }
        } else {
            actualPlugin = plugin;
        }
        if (actualPlugin && this._plugins.indexOf(actualPlugin) === -1) {
            this._plugins.push(actualPlugin);
        }
    }

    /**
     * Load a model using predefined configuration
     * @param modelConfiguration the modelConfiguration to use to load the model
     */
    public load(modelConfiguration: IModelConfiguration): ViewerModel {
        const model = new ViewerModel(this._observablesManager, modelConfiguration, this._configurationContainer);

        model.loadId = this._loadId++;

        let filename: any;
        if (modelConfiguration.file) {
            this._baseUrl = "file:";
            filename = modelConfiguration.file;
        } else if (modelConfiguration.url) {
            filename = Tools.GetFilename(modelConfiguration.url) || modelConfiguration.url;
            this._baseUrl = modelConfiguration.root || Tools.GetFolderPath(modelConfiguration.url);
        }

        if (!filename || !this._baseUrl) {
            model.state = ModelState.ERROR;
            Tools.Error("No URL provided");
            return model;
        }

        const plugin = modelConfiguration.loader;

        const scene = model.rootMesh.getScene();

        model.loader = SceneLoader.ImportMesh(
            undefined,
            this._baseUrl,
            filename,
            scene,
            (meshes, particleSystems, skeletons, animationGroups) => {
                meshes.forEach((mesh) => {
                    Tags.AddTagsTo(mesh, "viewerMesh");
                    model.addMesh(mesh);
                });
                model.particleSystems = particleSystems;
                model.skeletons = skeletons;

                for (const animationGroup of animationGroups) {
                    model.addAnimationGroup(animationGroup);
                }

                this._checkAndRun("onLoaded", model);
                scene.executeWhenReady(() => {
                    model.onLoadedObservable.notifyObservers(model);
                });
            },
            (progressEvent) => {
                this._checkAndRun("onProgress", progressEvent);
                model.onLoadProgressObservable.notifyObserversWithPromise(progressEvent);
            },
            (scene, m, exception) => {
                model.state = ModelState.ERROR;
                Tools.Error("Load Error: There was an error loading the model. " + m);
                this._checkAndRun("onError", m, exception);
                model.onLoadErrorObservable.notifyObserversWithPromise({ message: m, exception: exception });
            },
            plugin
        )!;

        if (model.loader.name === "gltf") {
            const gltfLoader = <GLTFFileLoader>model.loader;
            gltfLoader.animationStartMode = GLTFLoaderAnimationStartMode.NONE;
            gltfLoader.compileMaterials = true;

            if (!modelConfiguration.file) {
                gltfLoader.rewriteRootURL = (rootURL, responseURL) => {
                    return modelConfiguration.root || Tools.GetFolderPath(responseURL || modelConfiguration.url || "");
                };
            }
            // if ground is set to "mirror":
            if (
                this._configurationContainer &&
                this._configurationContainer.configuration &&
                this._configurationContainer.configuration.ground &&
                typeof this._configurationContainer.configuration.ground === "object" &&
                this._configurationContainer.configuration.ground.mirror
            ) {
                gltfLoader.useClipPlane = true;
            }
            Object.keys(gltfLoader)
                .filter((name) => name.indexOf("on") === 0 && name.indexOf("Observable") !== -1)
                .forEach((functionName) => {
                    gltfLoader[functionName].add((payload) => {
                        this._checkAndRun(functionName.replace("Observable", ""), payload);
                    });
                });

            gltfLoader.onParsedObservable.add((data) => {
                if (data && data.json && data.json["asset"]) {
                    model.loadInfo = data.json["asset"];
                }
            });

            gltfLoader.onCompleteObservable.add(() => {
                model.loaderDone = true;
            });
        } else {
            model.loaderDone = true;
        }

        this._checkAndRun("onInit", model.loader, model);

        this._loaders.push(model.loader);

        return model;
    }

    public cancelLoad(model: ViewerModel) {
        const loader = model.loader || this._loaders[model.loadId];
        // ATM only available in the GLTF Loader
        if (loader && loader.name === "gltf") {
            const gltfLoader = <GLTFFileLoader>loader;
            gltfLoader.dispose();
            model.state = ModelState.CANCELED;
        } else {
            Tools.Warn("This type of loader cannot cancel the request");
        }
    }

    /**
     * dispose the model loader.
     * If loaders are registered and are in the middle of loading, they will be disposed and the request(s) will be cancelled.
     */
    public dispose() {
        this._loaders.forEach((loader) => {
            if (loader.name === "gltf") {
                (<GLTFFileLoader>loader).dispose();
            }
        });
        this._loaders.length = 0;
        this._disposed = true;
    }

    private _checkAndRun(functionName: string, ...payload: Array<any>) {
        if (this._disposed) {
            return;
        }
        this._plugins
            .filter((p) => p[functionName])
            .forEach((plugin) => {
                try {
                    plugin[functionName].apply(this, payload);
                } catch (e) {}
            });
    }
}
