import { initViewer, loadModel } from './viewer.js';

initViewer(document.getElementById('preview')).then(viewer => {
    const urn = window.location.hash?.substring(1);
    setupModelSelection(viewer, urn);
    setupModelUpload(viewer);
    setupMetadata(viewer);
});

async function setupMetadata(viewer) {
    const btn = document.getElementById('metadata');
    if (btn) {
        btn.addEventListener('click', async () => {
            const selection = viewer.getSelection();
            if (selection.length !== 1) {
                showNotification('Please select exactly one element to view its metadata. <br><br><button id="close-notification">Close</button>');
                setTimeout(() => document.getElementById('close-notification')?.addEventListener('click', clearNotification), 0);
                return;
            }

            const dbId = selection[0];
            showNotification('Loading metadata...');

            try {
                // Get Properties
                const props = await new Promise((resolve, reject) => {
                    viewer.model.getProperties(dbId, resolve, reject);
                });

                // Get Geometry (Vertices)
                const tree = viewer.model.getInstanceTree();
                const frags = [];
                tree.enumNodeFragments(dbId, (fragId) => {
                    frags.push(fragId);
                });

                console.log(`Debug: Found ${frags.length} fragments for dbId ${dbId}`);

                let geometryHtml = '';
                let totalFaces = 0;

                // Helper to apply matrix to vector
                const applyMatrix = (v, m) => {
                    const x = v.x * m.elements[0] + v.y * m.elements[4] + v.z * m.elements[8] + m.elements[12];
                    const y = v.x * m.elements[1] + v.y * m.elements[5] + v.z * m.elements[9] + m.elements[13];
                    const z = v.x * m.elements[2] + v.y * m.elements[6] + v.z * m.elements[10] + m.elements[14];
                    return { x, y, z };
                };

                let allGeometryData = [];

                for (const fragId of frags) {
                    const renderProxy = viewer.impl.getRenderProxy(viewer.model, fragId);
                    console.log(`Debug: Processor fragment ${fragId}`, renderProxy);

                    if (!renderProxy) {
                        console.warn(`Debug: No renderProxy for fragment ${fragId}`);
                        continue;
                    }

                    const mesh = renderProxy.mesh || renderProxy;
                    const geometry = renderProxy.geometry || mesh.geometry;
                    const material = renderProxy.material || mesh.material;

                    let materialInfo = 'Unknown Material';
                    let matName = material ? material.name : null;

                    // Fallback: Check properties if material name is missing or generic
                    if ((!matName || matName.startsWith('Unnamed')) && props && props.properties) {
                        // Look for a property containing "Material" in its name
                        const materialProp = props.properties.find(p => p.displayName && p.displayName.toLowerCase().includes('material'));
                        if (materialProp) {
                            matName = materialProp.displayValue;
                        }
                    }

                    if (!matName) matName = 'Unnamed Material';

                    if (material) {
                        const matId = material.id ? `(ID: ${material.id})` : '(No ID)';
                        materialInfo = `${matName} ${matId}`;

                        if (material.color) {
                            materialInfo += ` (Color: #${material.color.getHexString()})`;
                        }
                        // Detailed debug of the material object to understand why name might be missing
                        console.log(`Debug: Material Object Detail for frag ${fragId}`, material);
                    } else {
                        materialInfo = matName; // If we found it in props but have no 3D material
                    }

                    console.log(`Debug: Mesh/Geometry/Material for ${fragId}`, { mesh, geometry, material });

                    if (!geometry) continue;

                    let positions = geometry.attributes.position ? geometry.attributes.position.array : null;
                    let indices = geometry.index ? geometry.index.array : null;
                    let stride = 3;

                    // Handle SVF2 / LeanBufferGeometry (packed buffers)
                    if (!positions && geometry.vb) {
                        positions = geometry.vb;
                        stride = geometry.vbstride || 3;
                    }
                    if (!indices && geometry.ib) {
                        indices = geometry.ib;
                    }

                    console.log(`Debug: Resolved geometry for ${fragId}`, { stride, hasPositions: !!positions, hasIndices: !!indices });

                    if (indices && positions) {
                        const facesCount = indices.length / 3;
                        totalFaces += facesCount;

                        for (let i = 0; i < indices.length; i += 3) {
                            const a = indices[i];
                            const b = indices[i + 1];
                            const c = indices[i + 2];

                            // Account for stride in vertex buffer
                            const vA = applyMatrix({ x: positions[a * stride], y: positions[a * stride + 1], z: positions[a * stride + 2] }, renderProxy.matrixWorld);
                            const vB = applyMatrix({ x: positions[b * stride], y: positions[b * stride + 1], z: positions[b * stride + 2] }, renderProxy.matrixWorld);
                            const vC = applyMatrix({ x: positions[c * stride], y: positions[c * stride + 1], z: positions[c * stride + 2] }, renderProxy.matrixWorld);

                            const faceIndex = Math.round(totalFaces - facesCount + (i / 3) + 1);

                            const faceData = {
                                faceIndex: faceIndex,
                                vertices: [vA, vB, vC],
                                material: materialInfo
                            };
                            allGeometryData.push(faceData);

                            geometryHtml += `
                                <div style="font-size: 0.8em; border-bottom: 1px solid #ccc; margin-bottom: 4px;">
                                    <strong>Face ${faceIndex}</strong> - <em>${materialInfo}</em>: <br>
                                    (${vA.x.toFixed(2)}, ${vA.y.toFixed(2)}, ${vA.z.toFixed(2)}) <br>
                                    (${vB.x.toFixed(2)}, ${vB.y.toFixed(2)}, ${vB.z.toFixed(2)}) <br>
                                    (${vC.x.toFixed(2)}, ${vC.y.toFixed(2)}, ${vC.z.toFixed(2)})
                                </div>`;
                        }
                    } else if (positions) {
                        // Non-indexed geometry
                        const facesCount = positions.length / (stride * 3);
                        totalFaces += facesCount;

                        for (let i = 0; i < positions.length; i += stride * 3) {
                            const vA = applyMatrix({ x: positions[i], y: positions[i + 1], z: positions[i + 2] }, renderProxy.matrixWorld);
                            const vB = applyMatrix({ x: positions[i + stride], y: positions[i + stride + 1], z: positions[i + stride + 2] }, renderProxy.matrixWorld);
                            const vC = applyMatrix({ x: positions[i + stride * 2], y: positions[i + stride * 2 + 1], z: positions[i + stride * 2 + 2] }, renderProxy.matrixWorld);

                            const faceIndex = Math.round(totalFaces - facesCount + (i / (stride * 3)) + 1);

                            const faceData = {
                                faceIndex: faceIndex,
                                vertices: [vA, vB, vC],
                                material: materialInfo
                            };
                            allGeometryData.push(faceData);

                            geometryHtml += `
                                <div style="font-size: 0.8em; border-bottom: 1px solid #ccc; margin-bottom: 4px;">
                                    <strong>Face ${faceIndex}</strong> - <em>${materialInfo}</em>: <br>
                                    (${vA.x.toFixed(2)}, ${vA.y.toFixed(2)}, ${vA.z.toFixed(2)}) <br>
                                    (${vB.x.toFixed(2)}, ${vB.y.toFixed(2)}, ${vB.z.toFixed(2)}) <br>
                                    (${vC.x.toFixed(2)}, ${vC.y.toFixed(2)}, ${vC.z.toFixed(2)})
                                </div>`;
                        }
                    }
                }

                // Log comprehensive metadata to console
                const completeMetadata = {
                    dbId: dbId,
                    name: props.name,
                    properties: props.properties,
                    totalFaces: totalFaces,
                    geometryData: allGeometryData
                };

                console.log("==================================================");
                console.log(`METADATA FOR ELEMENT ID: ${dbId} (${props.name})`);
                console.log("--------------------------------------------------");
                console.log(completeMetadata);
                console.log("==================================================");

                showNotification(`
                    <div style="max-height: 400px; overflow-y: auto; text-align: left;">
                        <h3>${props.name} (ID: ${dbId})</h3>
                        <h4>Properties</h4>
                        <ul>
                            ${props.properties.map(p => `<li><strong>${p.displayName}:</strong> ${p.displayValue}</li>`).join('')}
                        </ul>
                        <h4>Geometry</h4>
                        <p>Total Faces: ${totalFaces}</p>
                        ${geometryHtml}
                        <br>
                        <button id="close-notification">Close</button>
                    </div>
                `);

                setTimeout(() => document.getElementById('close-notification')?.addEventListener('click', clearNotification), 0);

            } catch (err) {
                console.error('Metadata extraction failed', err);
                showNotification(`Error: ${err.message} <br><button id="close-notification">Close</button>`);
                setTimeout(() => document.getElementById('close-notification')?.addEventListener('click', clearNotification), 0);
            }
        });
    }
}

async function setupModelSelection(viewer, selectedUrn) {
    const dropdown = document.getElementById('models');
    dropdown.innerHTML = '';
    try {
        const resp = await fetch('/api/models');
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const models = await resp.json();
        dropdown.innerHTML = models.map(model => `<option value=${model.urn} ${model.urn === selectedUrn ? 'selected' : ''}>${model.name}</option>`).join('\n');
        dropdown.onchange = () => onModelSelected(viewer, dropdown.value);
        if (dropdown.value) {
            onModelSelected(viewer, dropdown.value);
        }
    } catch (err) {
        alert('Could not list models. See the console for more details.');
        console.error(err);
    }
}

async function setupModelUpload(viewer) {
    const upload = document.getElementById('upload');
    const input = document.getElementById('input');
    const models = document.getElementById('models');
    upload.onclick = () => input.click();
    input.onchange = async () => {
        const file = input.files[0];
        let data = new FormData();
        data.append('model-file', file);
        if (file.name.endsWith('.zip')) { // When uploading a zip file, ask for the main design file in the archive
            const entrypoint = window.prompt('Please enter the filename of the main design inside the archive.');
            data.append('model-zip-entrypoint', entrypoint);
        }
        upload.setAttribute('disabled', 'true');
        models.setAttribute('disabled', 'true');
        showNotification(`Uploading model <em>${file.name}</em>. Do not reload the page.`);
        try {
            const resp = await fetch('/api/models', { method: 'POST', body: data });
            if (!resp.ok) {
                throw new Error(await resp.text());
            }
            const model = await resp.json();
            setupModelSelection(viewer, model.urn);
        } catch (err) {
            alert(`Could not upload model ${file.name}. See the console for more details.`);
            console.error(err);
        } finally {
            clearNotification();
            upload.removeAttribute('disabled');
            models.removeAttribute('disabled');
            input.value = '';
        }
    };
}

async function onModelSelected(viewer, urn) {
    if (window.onModelSelectedTimeout) {
        clearTimeout(window.onModelSelectedTimeout);
        delete window.onModelSelectedTimeout;
    }
    window.location.hash = urn;
    try {
        const resp = await fetch(`/api/models/${urn}/status`);
        if (!resp.ok) {
            throw new Error(await resp.text());
        }
        const status = await resp.json();
        switch (status.status) {
            case 'n/a':
                showNotification(`Model has not been translated.`);
                break;
            case 'inprogress':
                showNotification(`Model is being translated (${status.progress})...`);
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, viewer, urn);
                break;
            case 'failed':
                showNotification(`Translation failed. <ul>${status.messages.map(msg => `<li>${JSON.stringify(msg)}</li>`).join('')}</ul>`);
                break;
            default:
                clearNotification();
                loadModel(viewer, urn);
                break;
        }
    } catch (err) {
        alert('Could not load model. See the console for more details.');
        console.error(err);
    }
}

function showNotification(message) {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = `<div class="notification">${message}</div>`;
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    overlay.innerHTML = '';
    overlay.style.display = 'none';
}
