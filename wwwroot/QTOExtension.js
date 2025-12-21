class QuantitiesPanel extends Autodesk.Viewing.UI.DockingPanel {
    constructor(viewer, id, title, options) {
        super(viewer.container, id, title, options);
        this.viewer = viewer;
        this.container.classList.add('qto-panel');
        this.container.style.top = '10px';
        this.container.style.left = '10px';
        this.container.style.width = '400px';
        this.container.style.height = '500px';
        this.container.style.resize = 'both';

        this.onModelSelected = this.onModelSelected.bind(this);
    }

    initialize() {
        this.title = this.createTitleBar(this.titleLabel || this.container.id);
        this.container.appendChild(this.title);
        this.closer = this.createCloseButton();
        this.title.appendChild(this.closer);

        this.table = document.createElement('table');
        this.table.className = 'qto-table';
        this.table.innerHTML = `
            <thead>
                <tr>
                    <th>Family</th>
                    <th>Type</th>
                    <th>Count</th>
                    <th>Volume</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        this.container.appendChild(this.table);
    }

    async update(data) {
        const tbody = this.table.querySelector('tbody');
        tbody.innerHTML = '';
        for (const [key, value] of Object.entries(data)) {
            const [family, type] = key.split('|');
            const tr = document.createElement('tr');
            const totalVolume = value.volume.toFixed(2);
            tr.innerHTML = `
                <td>${family}</td>
                <td>${type}</td>
                <td>${value.dbIds.length}</td>
                <td>${totalVolume > 0 ? totalVolume + ' m³' : '-'}</td>
            `;
            tr.onclick = () => {
                this.viewer.isolate(value.dbIds);
                this.viewer.fitToView(value.dbIds);
            };
            tbody.appendChild(tr);
        }
    }

    onModelSelected(event) {
        // Redraw or update if needed
    }
}

class QTOExtension extends Autodesk.Viewing.Extension {
    constructor(viewer, options) {
        super(viewer, options);
        this._group = null;
        this._button = null;
    }

    load() {
        console.log('QTOExtension loaded');
        return true;
    }

    unload() {
        if (this._group) {
            this._group.removeControl(this._button);
            if (this._group.getNumberOfControls() === 0) {
                this.viewer.getToolbar(true).removeControl(this._group);
            }
        }
        return true;
    }

    onToolbarCreated() {
        this._group = this.viewer.getToolbar(true).getControl('customExtensionsGroup');
        if (!this._group) {
            this._group = new Autodesk.Viewing.UI.ControlGroup('customExtensionsGroup');
            this.viewer.getToolbar(true).addControl(this._group);
        }

        this._button = new Autodesk.Viewing.UI.Button('qtoExtensionButton');
        this._button.onClick = async (ev) => {
            if (!this._panel) {
                this._panel = new QuantitiesPanel(this.viewer, 'qtoPanel', 'Quantity Takeoff');
            }
            this._panel.setVisible(!this._panel.isVisible());
            if (this._panel.isVisible()) {
                const data = await this.extractData();
                this._panel.update(data);
            }
        };
        this._button.setToolTip('Quantity Takeoff');
        this._button.addClass('qto-icon');
        this._group.addControl(this._button);
    }

    async extractData() {
        return new Promise((resolve, reject) => {
            const data = {};
            this.viewer.getObjectTree((tree) => {
                const leaves = [];
                tree.enumNodeChildren(tree.getRootId(), (dbId) => {
                    if (tree.getChildCount(dbId) === 0) {
                        leaves.push(dbId);
                    }
                }, true);

                this.viewer.model.getBulkProperties(leaves, ['Family Name', 'Family', 'Type Name', 'Type', 'Volume'], (results) => {
                    for (const result of results) {
                        const familyProp = result.properties.find(p => p.displayName === 'Family Name' || p.displayName === 'Family');
                        const typeProp = result.properties.find(p => p.displayName === 'Type Name' || p.displayName === 'Type');
                        const volumeProp = result.properties.find(p => p.displayName === 'Volume');

                        const familyName = familyProp?.displayValue || 'Unknown';
                        const typeName = typeProp?.displayValue || 'Unknown';
                        const volumeValue = parseFloat(volumeProp?.displayValue) || 0;

                        const key = `${familyName}|${typeName}`;
                        if (!data[key]) {
                            data[key] = { dbIds: [], volume: 0 };
                        }
                        data[key].dbIds.push(result.dbId);
                        data[key].volume += volumeValue;
                    }
                    resolve(data);
                });
            });
        });
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension('QTOExtension', QTOExtension);
