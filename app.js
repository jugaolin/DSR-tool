/* ===== 实时横摆角速度标定工具 v3.0 - Web版 ===== */

const app = (() => {
    "use strict";

    /* ============ 状态 ============ */
    const S = {
        SA: [], V: [], Y: [],           // 网格数据 (Y is nSA x nV)
        dY_dSA: [], dY_dV: [],          // 初始斜率
        dY_dSA_adj: [], dY_dV_adj: [],  // 调整后斜率
        Y_original: [],
        nSA: 0, nV: 0,
        cellData: [],                    // Hermite 单元数据
        isBuilt: false,
        selectedSA_idx: -1,
        selectedV_idx: -1,
        selectedCells: [],               // Y值表格中选中的 [{r,c}, ...]
        steerDelta: null, steerRatio: null, // 前轮转角 MAP 结果
        steerSA: null, steerV: null,
    };

    /* ============ Chart 实例 ============ */
    const charts = {};
    let colorCycle = [
        '#3b82f6','#ef4444','#22c55e','#f97316','#8b5cf6',
        '#ec4899','#14b8a6','#eab308','#6366f1','#f43f5e',
        '#06b6d4','#84cc16','#d946ef','#0ea5e9','#10b981'
    ];

    function getColor(i) { return colorCycle[i % colorCycle.length]; }

    /* ============ 初始化 ============ */
    function init() {
        bindTopTabs();
        bindSubTabs();
        bindEvents();
        initCharts();
        // Initial resize for active tab
        setTimeout(() => Object.values(charts).forEach(c => c.resize()), 100);
    }

    function bindTopTabs() {
        document.querySelectorAll('.top-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('page-' + btn.dataset.tab).classList.add('active');
                // Multiple resize attempts to fix hidden canvas issue
                const resizeAll = () => Object.values(charts).forEach(c => {
                    c.resize();
                    c.update('none');
                });
                setTimeout(resizeAll, 50);
                setTimeout(resizeAll, 150);
                setTimeout(resizeAll, 300);
            });
        });
    }

    function bindSubTabs() {
        document.querySelectorAll('.sub-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.parentElement.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const panel = btn.closest('.ctrl-panel');
                panel.querySelectorAll('.sub-tab-panel').forEach(p => p.classList.remove('active'));
                panel.querySelector('#' + btn.dataset.subtab).classList.add('active');
            });
        });
    }

    function bindEvents() {
        // 文件导入
        $('btnImportKeyCSV').onclick = () => $('fileInputKey').click();
        $('btnImportCSV').onclick = () => $('fileInput').click();
        $('fileInputKey').addEventListener('change', e => handleFileImport(e, true));
        $('fileInput').addEventListener('change', e => handleFileImport(e, false));

        // 导出
        $('btnExportMAP').onclick = () => exportMAP();
        $('btnExportMAP2').onclick = () => exportMAP();
        $('btnExportCSV').onclick = () => exportYCSV();
        $('btnExportYCSV2').onclick = () => exportYCSV();
        $('btnExportSlopeCSV').onclick = () => exportAdjustedSlopeCSV();
        $('btnExportExcel').onclick = () => exportExcelCSV();

        // 操作
        $('btnBuild').onclick = () => buildSurface();
        $('btnResetSlopes').onclick = () => resetAllSlopes();

        // 下拉选择
        $('popupV').addEventListener('change', onPopupChanged);
        $('popupSA').addEventListener('change', onPopupChanged);

        // 滑块
        $('sliderDYdSA').addEventListener('input', e => { $('editDYdSA').value = parseFloat(e.target.value).toFixed(3); });
        $('sliderDYdV').addEventListener('input', e => { $('editDYdV').value = parseFloat(e.target.value).toFixed(3); });

        // Bode
        $('btnUpdateBode').onclick = () => updateBodePlot();
        $('btnResetParams').onclick = () => resetBodeParams();

        // Steer page
        $('btnGenSteerMap').onclick = () => generateSteeringMap();
        $('btnResetSteerParams').onclick = () => resetSteerParams();

        // Ratio page
        $('btnGenRatioMap').onclick = () => generateRatioMap();
        $('btnResetRatioParams').onclick = () => resetRatioParams();
    }

    function $(id) { return document.getElementById(id); }

    /* ============ Chart 初始化 ============ */
    function initCharts() {
        const commonOpts = {
            responsive: true, maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 12, padding: 4 } } },
            scales: {
                x: { title: { display: true, font: { size: 11 } }, grid: { color: '#e2e8f0' } },
                y: { title: { display: true, font: { size: 11 } }, grid: { color: '#e2e8f0' } }
            }
        };
        const makeOpts = (xLabel, yLabel, titleText, onClickFn) => {
            const o = JSON.parse(JSON.stringify(commonOpts));
            o.scales.x.title.text = xLabel;
            o.scales.y.title.text = yLabel;
            o.plugins.title = { display: true, text: titleText, font: { size: 12, weight: '600' } };
            if (onClickFn) o.onClick = onClickFn;
            return o;
        };
        const makeLogOpts = (xLabel, yLabel, titleText) => {
            const o = makeOpts(xLabel, yLabel, titleText);
            o.scales.x.type = 'logarithmic';
            return o;
        };

        charts.YSA = new Chart($('chartYSA'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('SA (deg)', 'Y (deg/s)', 'Y(SA) 曲线', onChartClickSA) });
        charts.SlopeSA = new Chart($('chartSlopeSA'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('SA (deg)', 'dY/dSA', 'dY/dSA 斜率', onChartClickSA) });
        charts.YV = new Chart($('chartYV'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('V (km/h)', 'Y (deg/s)', 'Y(V) 曲线', onChartClickV) });
        charts.SlopeV = new Chart($('chartSlopeV'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('V (km/h)', 'dY/dV', 'dY/dV 斜率', onChartClickV) });

        // Bode charts
        charts.GinvMag = new Chart($('chartGinvMag'), { type: 'scatter', data: { datasets: [] }, options: makeLogOpts('频率 (Hz)', '幅值 (dB)', 'G_inv(s) 幅值') });
        charts.GinvPhase = new Chart($('chartGinvPhase'), { type: 'scatter', data: { datasets: [] }, options: makeLogOpts('频率 (Hz)', '相位 (deg)', 'G_inv(s) 相位') });
        charts.HMag = new Chart($('chartHMag'), { type: 'scatter', data: { datasets: [] }, options: makeLogOpts('频率 (Hz)', '幅值 (dB)', 'H(s) 幅值') });
        charts.HPhase = new Chart($('chartHPhase'), { type: 'scatter', data: { datasets: [] }, options: makeLogOpts('频率 (Hz)', '相位 (deg)', 'H(s) 相位') });
        charts.GtotalMag = new Chart($('chartGtotalMag'), { type: 'scatter', data: { datasets: [] }, options: makeLogOpts('频率 (Hz)', '幅值 (dB)', 'G_total(s) 幅值') });
        charts.GtotalPhase = new Chart($('chartGtotalPhase'), { type: 'scatter', data: { datasets: [] }, options: makeLogOpts('频率 (Hz)', '相位 (deg)', 'G_total(s) 相位') });

        // Steer page charts
        charts.SteerSA = new Chart($('chartSteerSA'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('SA (deg)', '前轮转角 δ (deg)', '前轮转角 vs 方向盘角度') });
        charts.SteerV = new Chart($('chartSteerV'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('V (km/h)', '前轮转角 δ (deg)', '前轮转角 vs 车速') });
        charts.RatioSA = new Chart($('chartRatioSA'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('SA (deg)', '传动比 SA/δ', '传动比 vs 方向盘角度') });
        charts.RatioV = new Chart($('chartRatioV'), { type: 'scatter', data: { datasets: [] }, options: makeOpts('V (km/h)', '传动比 SA/δ', '传动比 vs 车速') });
    }

    /* ============ 图表点击联动 ============ */
    function onChartClickSA(evt, elements, chart) {
        if (!elements.length || S.nSA === 0) return;
        const el = elements[0];
        const ds = chart.data.datasets[el.datasetIndex];
        if (ds._isHighlight) return;
        const pt = ds.data[el.index];
        const vIdx = ds._vIdx !== undefined ? ds._vIdx : findClosestIdx(S.V, pt.y);
        const saIdx = findClosestIdx(S.SA, pt.x);
        selectPoint(saIdx, vIdx);
    }

    function onChartClickV(evt, elements, chart) {
        if (!elements.length || S.nSA === 0) return;
        const el = elements[0];
        const ds = chart.data.datasets[el.datasetIndex];
        if (ds._isHighlight) return;
        const pt = ds.data[el.index];
        const saIdx = ds._saIdx !== undefined ? ds._saIdx : findClosestIdx(S.SA, pt.y);
        const vIdx = findClosestIdx(S.V, pt.x);
        selectPoint(saIdx, vIdx);
    }

    function findClosestIdx(arr, val) {
        let best = 0, bestDist = Infinity;
        for (let i = 0; i < arr.length; i++) {
            const d = Math.abs(arr[i] - val);
            if (d < bestDist) { bestDist = d; best = i; }
        }
        return best;
    }

    function selectPoint(saIdx, vIdx) {
        S.selectedSA_idx = saIdx;
        S.selectedV_idx = vIdx;
        $('popupV').value = vIdx;
        $('popupSA').value = saIdx;
        onPopupChanged();
        updateHighlight();
    }

    function updateHighlight() {
        if (S.selectedSA_idx < 0 || S.selectedV_idx < 0) return;
        const si = S.selectedSA_idx, vi = S.selectedV_idx;
        const sa = S.SA[si], v = S.V[vi];

        // 更新 Y(SA) 图高亮
        updateChartHighlight(charts.YSA, sa, S.Y[si][vi]);
        // 更新 dY/dSA 图高亮
        updateChartHighlight(charts.SlopeSA, sa, S.dY_dSA_adj[si][vi]);
        // 更新 Y(V) 图高亮
        updateChartHighlight(charts.YV, v, S.Y[si][vi]);
        // 更新 dY/dV 图高亮
        updateChartHighlight(charts.SlopeV, v, S.dY_dV_adj[si][vi]);
    }

    function updateChartHighlight(chart, xVal, yVal) {
        const hlDs = chart.data.datasets.find(d => d._isHighlight);
        if (hlDs) {
            hlDs.data = [{ x: xVal, y: yVal }];
            chart.update('none');
        }
    }

    /* ============ 文件导入 ============ */
    function handleFileImport(e, isKey) {
        const file = e.target.files[0];
        if (!file) return;
        Papa.parse(file, {
            complete(results) {
                try {
                    const rows = results.data.filter(r => r.length > 1 && r.some(c => c !== ''));
                    if (rows.length < 2) throw new Error('数据行不足');

                    // 第一行: 首格可能为 "V/SA" 或空, 之后为 SA 值
                    const headerRow = rows[0];
                    const startCol = isNaN(parseFloat(headerRow[0])) ? 1 : 0;
                    const SA_vals = [];
                    for (let c = startCol; c < headerRow.length; c++) {
                        const v = parseFloat(headerRow[c]);
                        if (!isNaN(v)) SA_vals.push(v);
                    }

                    // 数据行: 首列为 V 值, 之后为 Y 值
                    const V_vals = [];
                    const Y_rows = [];
                    for (let r = 1; r < rows.length; r++) {
                        const row = rows[r];
                        const v = parseFloat(row[0]);
                        if (isNaN(v)) continue;
                        V_vals.push(v);
                        const yrow = [];
                        for (let c = startCol; c < startCol + SA_vals.length; c++) {
                            yrow.push(parseFloat(row[c]) || 0);
                        }
                        Y_rows.push(yrow);
                    }

                    // 排序
                    const saOrder = SA_vals.map((v, i) => i).sort((a, b) => SA_vals[a] - SA_vals[b]);
                    const vOrder = V_vals.map((v, i) => i).sort((a, b) => V_vals[a] - V_vals[b]);

                    S.SA = saOrder.map(i => SA_vals[i]);
                    S.V = vOrder.map(i => V_vals[i]);
                    S.nSA = S.SA.length;
                    S.nV = S.V.length;

                    // Y 矩阵: nSA x nV  (MATLAB 中 Y(jj, ii) 即 SA列, V行)
                    S.Y = [];
                    for (let si = 0; si < S.nSA; si++) {
                        S.Y[si] = [];
                        for (let vi = 0; vi < S.nV; vi++) {
                            S.Y[si][vi] = Y_rows[vOrder[vi]][saOrder[si]];
                        }
                    }

                    S.Y_original = S.Y.map(r => [...r]);
                    S.dY_dSA = computeInitialSlopes(S.SA, S.V, S.Y, 'SA');
                    S.dY_dV = computeInitialSlopes(S.SA, S.V, S.Y, 'V');
                    S.dY_dSA_adj = S.dY_dSA.map(r => [...r]);
                    S.dY_dV_adj = S.dY_dV.map(r => [...r]);
                    S.isBuilt = false;
                    S.selectedSA_idx = -1;
                    S.selectedV_idx = -1;

                    updatePopupSelects();
                    updateAllTables();
                    updatePlots();
                    onPopupChanged();

                    $('importStatus').textContent = `已导入: ${file.name} (${S.nSA}SA x ${S.nV}V)`;
                    $('importStatus').classList.remove('muted');
                    $('importStatus').style.color = '#16a34a';
                    $('statusText').textContent = `状态: 网格已创建 (${S.nSA}x${S.nV})`;
                    $('statusText').style.color = '#16a34a';
                } catch (err) {
                    alert('导入失败: ' + err.message);
                }
                e.target.value = '';
            },
            error(err) { alert('文件解析错误: ' + err.message); e.target.value = ''; }
        });
    }

    /* ============ 下拉列表 ============ */
    function updatePopupSelects() {
        const popV = $('popupV'), popSA = $('popupSA');
        popV.innerHTML = S.V.map((v, i) => `<option value="${i}">${v.toFixed(0)}</option>`).join('');
        popSA.innerHTML = S.SA.map((s, i) => `<option value="${i}">${s.toFixed(0)}</option>`).join('');
    }

    function onPopupChanged() {
        if (S.nSA === 0) return;
        const vi = parseInt($('popupV').value);
        const si = parseInt($('popupSA').value);
        S.selectedSA_idx = si;
        S.selectedV_idx = vi;

        const SA_val = S.SA[si], V_val = S.V[vi];
        const Y_val = S.Y[si][vi];
        const dSA = S.dY_dSA_adj[si][vi], dV = S.dY_dV_adj[si][vi];

        $('currentPoint').textContent = `当前点: V=${V_val.toFixed(0)}, SA=${SA_val.toFixed(0)}`;
        $('currentValues').textContent = `Y=${Y_val.toFixed(2)}    dY/dSA=${dSA.toFixed(4)}    dY/dV=${dV.toFixed(4)}`;
        $('editDYdSA').value = dSA.toFixed(4);
        $('editDYdV').value = dV.toFixed(4);
        $('sliderDYdSA').value = Math.min(Math.max(dSA, 0), 2);
        $('sliderDYdV').value = Math.min(Math.max(dV, 0), 5);
        $('textCurDYdSA').textContent = `当前值: ${dSA.toFixed(4)}`;
        $('textCurDYdV').textContent = `当前值: ${dV.toFixed(4)}`;
        $('statusText').textContent = `状态: 已选中 V=${V_val.toFixed(0)}, SA=${SA_val.toFixed(0)}`;
        $('statusText').style.color = '#16a34a';
    }

    /* ============ 表格渲染 ============ */
    function buildTable(data, colHeaders, rowHeaders, editable, tableName) {
        let html = '<table class="data-table"><thead><tr><th class="corner">V\\SA</th>';
        for (const h of colHeaders) html += `<th>${h}</th>`;
        html += '</tr></thead><tbody>';
        for (let r = 0; r < data.length; r++) {
            html += `<tr><th>${rowHeaders[r]}</th>`;
            for (let c = 0; c < data[r].length; c++) {
                const cls = editable ? 'editable' : '';
                const val = typeof data[r][c] === 'number' ? data[r][c].toFixed(4) : data[r][c];
                if (editable) {
                    html += `<td class="${cls}" contenteditable="true" data-r="${r}" data-c="${c}" data-table="${tableName}">${val}</td>`;
                } else {
                    html += `<td class="${cls}">${val}</td>`;
                }
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        return html;
    }

    function updateAllTables() {
        const saH = S.SA.map(v => v.toFixed(0));
        const vH = S.V.map(v => v.toFixed(0));

        // Y table: data is transposed for display (rows=V, cols=SA)
        const Yt = transpose(S.Y);
        $('tblYWrap').innerHTML = buildTable(Yt, saH, vH, true, 'Y');

        // Attach edit events
        $('tblYWrap').querySelectorAll('td[contenteditable]').forEach(td => {
            td.addEventListener('blur', onYCellEdit);
            td.addEventListener('click', onYCellClick);
        });

        $('tbldYdSAWrap').innerHTML = buildTable(transpose(S.dY_dSA), saH, vH, false, 'dYdSA');
        $('tbldYdVWrap').innerHTML = buildTable(transpose(S.dY_dV), saH, vH, false, 'dYdV');
        $('tbldYdSAAdjWrap').innerHTML = buildTable(transpose(S.dY_dSA_adj), saH, vH, true, 'dYdSAAdj');
        $('tbldYdVAdjWrap').innerHTML = buildTable(transpose(S.dY_dV_adj), saH, vH, true, 'dYdVAdj');

        $('tbldYdSAAdjWrap').querySelectorAll('td[contenteditable]').forEach(td => {
            td.addEventListener('blur', onAdjSACellEdit);
        });
        $('tbldYdVAdjWrap').querySelectorAll('td[contenteditable]').forEach(td => {
            td.addEventListener('blur', onAdjVCellEdit);
        });
    }

    function transpose(matrix) {
        if (!matrix.length) return [];
        const rows = matrix[0].length, cols = matrix.length;
        const t = [];
        for (let r = 0; r < rows; r++) {
            t[r] = [];
            for (let c = 0; c < cols; c++) t[r][c] = matrix[c][r];
        }
        return t;
    }

    function onYCellEdit(e) {
        const r = parseInt(e.target.dataset.r); // V index
        const c = parseInt(e.target.dataset.c); // SA index
        const val = parseFloat(e.target.textContent);
        if (isNaN(val)) return;
        S.Y[c][r] = val;
        S.dY_dSA = computeInitialSlopes(S.SA, S.V, S.Y, 'SA');
        S.dY_dV = computeInitialSlopes(S.SA, S.V, S.Y, 'V');
        S.dY_dSA_adj = S.dY_dSA.map(row => [...row]);
        S.dY_dV_adj = S.dY_dV.map(row => [...row]);
        S.Y_original = S.Y.map(row => [...row]);
        S.isBuilt = false;
        updateAllTables();
        updatePlots();
    }

    function onYCellClick(e) {
        // 多选支持
        const td = e.target;
        if (e.ctrlKey || e.metaKey) {
            td.classList.toggle('selected');
        } else {
            $('tblYWrap').querySelectorAll('td.selected').forEach(t => t.classList.remove('selected'));
            td.classList.add('selected');
        }
        // 收集选中的单元格
        S.selectedCells = [];
        $('tblYWrap').querySelectorAll('td.selected').forEach(t => {
            S.selectedCells.push({ r: parseInt(t.dataset.r), c: parseInt(t.dataset.c) });
        });
        const n = S.selectedCells.length;
        if (n <= 3 && n > 0) {
            const details = S.selectedCells.map(sc => `V=${S.V[sc.r].toFixed(0)},SA=${S.SA[sc.c].toFixed(0)}`);
            $('selectionStatus').textContent = `已选择: ${n} 个 (${details.join('; ')})`;
        } else {
            $('selectionStatus').textContent = `已选择: ${n} 个单元格`;
        }
    }

    function onAdjSACellEdit(e) {
        const r = parseInt(e.target.dataset.r);
        const c = parseInt(e.target.dataset.c);
        const val = parseFloat(e.target.textContent);
        if (isNaN(val)) return;
        S.dY_dSA_adj[c][r] = val;
        S.isBuilt = false;
        updatePlots();
    }

    function onAdjVCellEdit(e) {
        const r = parseInt(e.target.dataset.r);
        const c = parseInt(e.target.dataset.c);
        const val = parseFloat(e.target.textContent);
        if (isNaN(val)) return;
        S.dY_dV_adj[c][r] = val;
        S.isBuilt = false;
        updatePlots();
    }

    /* ============ Y值批量调整 ============ */
    function adjustYValues(op) {
        if (S.nSA === 0) return;
        const val = parseFloat($('editYAdjust').value);
        if (isNaN(val)) return;

        const cells = S.selectedCells.length > 0 ? S.selectedCells : null;

        if (!cells) {
            // 调整全部
            for (let si = 0; si < S.nSA; si++) {
                for (let vi = 0; vi < S.nV; vi++) {
                    S.Y[si][vi] = applyOp(S.Y[si][vi], op, val);
                }
            }
        } else {
            for (const sc of cells) {
                // sc.r = V index, sc.c = SA index (表格转置后)
                S.Y[sc.c][sc.r] = applyOp(S.Y[sc.c][sc.r], op, val);
            }
        }

        S.Y_original = S.Y.map(r => [...r]);
        S.dY_dSA = computeInitialSlopes(S.SA, S.V, S.Y, 'SA');
        S.dY_dV = computeInitialSlopes(S.SA, S.V, S.Y, 'V');
        S.dY_dSA_adj = S.dY_dSA.map(r => [...r]);
        S.dY_dV_adj = S.dY_dV.map(r => [...r]);
        S.isBuilt = false;
        updateAllTables();
        buildSurface();
    }

    function applyOp(v, op, val) {
        switch (op) {
            case 'add': return v + val;
            case 'sub': return v - val;
            case 'mul': return v * val;
            case 'div': return val !== 0 ? v / val : v;
        }
        return v;
    }

    /* ============ 斜率调整 ============ */
    function setSinglePointSlope(dir) {
        if (S.nSA === 0 || S.selectedSA_idx < 0 || S.selectedV_idx < 0) {
            alert('请先选择要调整的点');
            return;
        }
        const si = S.selectedSA_idx, vi = S.selectedV_idx;
        if (dir === 'SA') {
            const v = parseFloat($('editDYdSA').value);
            if (isNaN(v)) return;
            S.dY_dSA_adj[si][vi] = v;
        } else {
            const v = parseFloat($('editDYdV').value);
            if (isNaN(v)) return;
            S.dY_dV_adj[si][vi] = v;
        }
        S.isBuilt = false;
        updateYFromSlopes();
        updateAllTables();
        buildSurface();
    }

    function resetAllSlopes() {
        if (S.nSA === 0) return;
        S.dY_dSA_adj = S.dY_dSA.map(r => [...r]);
        S.dY_dV_adj = S.dY_dV.map(r => [...r]);
        if (S.Y_original.length) S.Y = S.Y_original.map(r => [...r]);
        S.isBuilt = false;
        onPopupChanged();
        updateAllTables();
        buildSurface();
    }

    function updateYFromSlopes() {
        if (!S.Y_original.length) return;
        for (let si = 0; si < S.nSA; si++) {
            for (let vi = 0; vi < S.nV; vi++) {
                const dSA = S.SA[si] - S.SA[0];
                const dV = S.V[vi] - S.V[0];
                S.Y[si][vi] = S.Y_original[si][vi] +
                    (S.dY_dSA_adj[si][vi] - S.dY_dSA[si][vi]) * dSA * 0.1 +
                    (S.dY_dV_adj[si][vi] - S.dY_dV[si][vi]) * dV * 0.1;
            }
        }
    }

    /* ============ 核心算法: PCHIP 斜率计算 ============ */
    function computeInitialSlopes(X, Y_axis, Ymat, direction) {
        // X = grid points along the differentiation direction
        // Y_axis = grid points along the other direction
        // Ymat[si][vi] = Y value at (SA[si], V[vi])
        // direction = 'SA' => differentiate along SA axis
        // direction = 'V' => differentiate along V axis
        const nSA = S.nSA, nV = S.nV;
        const slopes = [];
        for (let i = 0; i < nSA; i++) { slopes[i] = []; for (let j = 0; j < nV; j++) slopes[i][j] = 0; }

        if (direction === 'SA') {
            for (let j = 0; j < nV; j++) {
                const y = [];
                for (let i = 0; i < nSA; i++) y.push(Ymat[i][j]);
                const d = pchipDerivatives(S.SA, y);
                for (let i = 0; i < nSA; i++) slopes[i][j] = d[i];
            }
        } else {
            for (let i = 0; i < nSA; i++) {
                const y = [];
                for (let j = 0; j < nV; j++) y.push(Ymat[i][j]);
                const d = pchipDerivatives(S.V, y);
                for (let j = 0; j < nV; j++) slopes[i][j] = d[j];
            }
        }
        return slopes;
    }

    // PCHIP (Fritsch-Carlson) derivatives
    function pchipDerivatives(x, y) {
        const n = x.length;
        if (n < 2) return y.map(() => 0);
        if (n === 2) {
            const m = (y[1] - y[0]) / (x[1] - x[0]);
            return [m, m];
        }

        // Divided differences
        const h = [], delta = [];
        for (let i = 0; i < n - 1; i++) {
            h[i] = x[i + 1] - x[i];
            delta[i] = (y[i + 1] - y[i]) / h[i];
        }

        // Initial derivatives (weighted harmonic mean)
        const d = [];
        d[0] = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1]);
        for (let i = 1; i < n - 1; i++) {
            if (delta[i - 1] * delta[i] <= 0) {
                d[i] = 0;
            } else {
                const w1 = 2 * h[i] + h[i - 1];
                const w2 = h[i] + 2 * h[i - 1];
                d[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
            }
        }
        d[n - 1] = ((2 * h[n - 2] + h[n - 3]) * delta[n - 2] - h[n - 2] * delta[n - 3]) / (h[n - 2] + h[n - 3]);

        // Monotonicity constraint (Fritsch-Carlson)
        for (let i = 0; i < n - 1; i++) {
            if (Math.abs(delta[i]) < 1e-15) {
                d[i] = 0;
                d[i + 1] = 0;
            } else {
                const alpha = d[i] / delta[i];
                const beta = d[i + 1] / delta[i];
                const tau = alpha * alpha + beta * beta;
                if (tau > 9) {
                    const s = 3 / Math.sqrt(tau);
                    d[i] = s * alpha * delta[i];
                    d[i + 1] = s * beta * delta[i];
                }
            }
        }

        return d;
    }

    /* ============ 核心算法: Hermite 插值 ============ */
    function buildHermiteCells() {
        const nSA = S.nSA, nV = S.nV;
        const cells = [];
        for (let ii = 0; ii < nSA - 1; ii++) {
            cells[ii] = [];
            for (let jj = 0; jj < nV - 1; jj++) {
                const dSA = S.SA[ii + 1] - S.SA[ii];
                const dV = S.V[jj + 1] - S.V[jj];
                const f00 = S.Y[ii][jj], f01 = S.Y[ii][jj + 1];
                const f10 = S.Y[ii + 1][jj], f11 = S.Y[ii + 1][jj + 1];
                const fs00 = S.dY_dSA_adj[ii][jj] * dSA, fs01 = S.dY_dSA_adj[ii][jj + 1] * dSA;
                const fs10 = S.dY_dSA_adj[ii + 1][jj] * dSA, fs11 = S.dY_dSA_adj[ii + 1][jj + 1] * dSA;
                const ft00 = S.dY_dV_adj[ii][jj] * dV, ft01 = S.dY_dV_adj[ii][jj + 1] * dV;
                const ft10 = S.dY_dV_adj[ii + 1][jj] * dV, ft11 = S.dY_dV_adj[ii + 1][jj + 1] * dV;
                const F = [
                    [f00, f01, ft00, ft01],
                    [f10, f11, ft10, ft11],
                    [fs00, fs01, 0, 0],
                    [fs10, fs11, 0, 0]
                ];
                cells[ii][jj] = { SA0: S.SA[ii], dSA, V0: S.V[jj], dV, F };
            }
        }
        return cells;
    }

    function evalHermite(SA, V) {
        const m = S.nSA, n = S.nV;
        let i, s, j, t;

        if (SA <= S.SA[0]) { i = 0; s = 0; }
        else if (SA >= S.SA[m - 1]) { i = m - 2; s = 1; }
        else {
            i = 0;
            for (let k = 0; k < m - 1; k++) { if (S.SA[k] <= SA) i = k; }
            s = (SA - S.SA[i]) / (S.SA[i + 1] - S.SA[i]);
        }

        if (V <= S.V[0]) { j = 0; t = 0; }
        else if (V >= S.V[n - 1]) { j = n - 2; t = 1; }
        else {
            j = 0;
            for (let k = 0; k < n - 1; k++) { if (S.V[k] <= V) j = k; }
            t = (V - S.V[j]) / (S.V[j + 1] - S.V[j]);
        }

        const data = S.cellData[i][j];
        const F = data.F;
        const s2 = s * s, s3 = s2 * s;
        const H0s = 2 * s3 - 3 * s2 + 1, H1s = -2 * s3 + 3 * s2;
        const H2s = s3 - 2 * s2 + s, H3s = s3 - s2;
        const t2 = t * t, t3 = t2 * t;
        const H0t = 2 * t3 - 3 * t2 + 1, H1t = -2 * t3 + 3 * t2;
        const H2t = t3 - 2 * t2 + t, H3t = t3 - t2;

        const Hs = [H0s, H1s, H2s, H3s];
        const Ht = [H0t, H1t, H2t, H3t];
        let Y = 0;
        for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) Y += Hs[a] * F[a][b] * Ht[b];
        return Y;
    }

    function evalSlopeHermite(SA, V, direction) {
        const m = S.nSA, n = S.nV;
        let i, s, j, t;

        if (SA <= S.SA[0]) { i = 0; s = 0; }
        else if (SA >= S.SA[m - 1]) { i = m - 2; s = 1; }
        else {
            i = 0;
            for (let k = 0; k < m - 1; k++) { if (S.SA[k] <= SA) i = k; }
            s = (SA - S.SA[i]) / (S.SA[i + 1] - S.SA[i]);
        }

        if (V <= S.V[0]) { j = 0; t = 0; }
        else if (V >= S.V[n - 1]) { j = n - 2; t = 1; }
        else {
            j = 0;
            for (let k = 0; k < n - 1; k++) { if (S.V[k] <= V) j = k; }
            t = (V - S.V[j]) / (S.V[j + 1] - S.V[j]);
        }

        const data = S.cellData[i][j];
        const F = data.F;
        const s2 = s * s, s3 = s2 * s;
        const t2 = t * t, t3 = t2 * t;

        if (direction === 'SA') {
            const dH0ds = 6 * s2 - 6 * s, dH1ds = -6 * s2 + 6 * s;
            const dH2ds = 3 * s2 - 4 * s + 1, dH3ds = 3 * s2 - 2 * s;
            const H0t = 2 * t3 - 3 * t2 + 1, H1t = -2 * t3 + 3 * t2;
            const H2t = t3 - 2 * t2 + t, H3t = t3 - t2;
            const Hs = [dH0ds, dH1ds, dH2ds, dH3ds];
            const Ht = [H0t, H1t, H2t, H3t];
            let slope = 0;
            for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) slope += Hs[a] * F[a][b] * Ht[b];
            return slope / data.dSA;
        } else {
            const H0s = 2 * s3 - 3 * s2 + 1, H1s = -2 * s3 + 3 * s2;
            const H2s = s3 - 2 * s2 + s, H3s = s3 - s2;
            const dH0dt = 6 * t2 - 6 * t, dH1dt = -6 * t2 + 6 * t;
            const dH2dt = 3 * t2 - 4 * t + 1, dH3dt = 3 * t2 - 2 * t;
            const Hs = [H0s, H1s, H2s, H3s];
            const Ht = [dH0dt, dH1dt, dH2dt, dH3dt];
            let slope = 0;
            for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) slope += Hs[a] * F[a][b] * Ht[b];
            return slope / data.dV;
        }
    }

    /* ============ 构建曲面 ============ */
    function buildSurface() {
        if (S.nSA === 0) return;
        S.cellData = buildHermiteCells();
        S.isBuilt = true;
        updatePlots();
        $('statusText').textContent = '状态: 曲面已构建';
        $('statusText').style.color = '#16a34a';
    }

    /* ============ 更新图表 ============ */
    function updatePlots() {
        if (S.nSA === 0) return;

        const SA_cont = linspace(S.SA[0], S.SA[S.nSA - 1], 100);
        const V_cont = linspace(S.V[0], S.V[S.V.length - 1], 100);

        // Y(SA) chart
        {
            const datasets = [];
            for (let j = 0; j < S.nV; j++) {
                const pts = S.SA.map((sa, i) => ({ x: sa, y: S.Y[i][j] }));
                datasets.push({
                    label: `V=${S.V[j].toFixed(0)}`,
                    data: pts, _vIdx: j,
                    borderColor: getColor(j), backgroundColor: getColor(j),
                    pointRadius: 4, showLine: false, borderWidth: 0
                });
                if (S.isBuilt) {
                    const line = SA_cont.map(sa => ({ x: sa, y: evalHermite(sa, S.V[j]) }));
                    datasets.push({
                        label: `V=${S.V[j].toFixed(0)}`,
                        data: line, _vIdx: j,
                        borderColor: getColor(j), backgroundColor: 'transparent',
                        pointRadius: 0, showLine: true, borderWidth: 1.5
                    });
                }
            }
            // highlight
            if (S.selectedSA_idx >= 0 && S.selectedV_idx >= 0) {
                datasets.push({
                    label: '选中', _isHighlight: true,
                    data: [{ x: S.SA[S.selectedSA_idx], y: S.Y[S.selectedSA_idx][S.selectedV_idx] }],
                    borderColor: '#ef4444', backgroundColor: '#ef4444',
                    pointRadius: 10, pointStyle: 'circle', showLine: false, borderWidth: 3
                });
            }
            charts.YSA.data.datasets = datasets;
            charts.YSA.update();
        }

        // dY/dSA chart
        {
            const datasets = [];
            for (let j = 0; j < S.nV; j++) {
                const pts = S.SA.map((sa, i) => ({ x: sa, y: S.dY_dSA_adj[i][j] }));
                datasets.push({
                    label: `V=${S.V[j].toFixed(0)}`,
                    data: pts, _vIdx: j,
                    borderColor: getColor(j), backgroundColor: getColor(j),
                    pointRadius: 4, showLine: false, borderWidth: 0
                });
                if (S.isBuilt) {
                    const line = SA_cont.map(sa => ({ x: sa, y: evalSlopeHermite(sa, S.V[j], 'SA') }));
                    datasets.push({
                        label: `V=${S.V[j].toFixed(0)}`,
                        data: line, _vIdx: j,
                        borderColor: getColor(j), backgroundColor: 'transparent',
                        pointRadius: 0, showLine: true, borderWidth: 1.5
                    });
                }
            }
            // zero line
            datasets.push({
                label: '', data: [{ x: S.SA[0], y: 0 }, { x: S.SA[S.nSA - 1], y: 0 }],
                borderColor: '#94a3b8', borderDash: [4, 4], pointRadius: 0, showLine: true, borderWidth: 1
            });
            if (S.selectedSA_idx >= 0 && S.selectedV_idx >= 0) {
                datasets.push({
                    label: '选中', _isHighlight: true,
                    data: [{ x: S.SA[S.selectedSA_idx], y: S.dY_dSA_adj[S.selectedSA_idx][S.selectedV_idx] }],
                    borderColor: '#ef4444', backgroundColor: '#ef4444',
                    pointRadius: 10, showLine: false, borderWidth: 3
                });
            }
            charts.SlopeSA.data.datasets = datasets;
            charts.SlopeSA.update();
        }

        // Y(V) chart
        {
            const datasets = [];
            for (let i = 0; i < S.nSA; i++) {
                const pts = S.V.map((v, j) => ({ x: v, y: S.Y[i][j] }));
                datasets.push({
                    label: `SA=${S.SA[i].toFixed(0)}`,
                    data: pts, _saIdx: i,
                    borderColor: getColor(i), backgroundColor: getColor(i),
                    pointRadius: 4, showLine: false, borderWidth: 0
                });
                if (S.isBuilt) {
                    const line = V_cont.map(v => ({ x: v, y: evalHermite(S.SA[i], v) }));
                    datasets.push({
                        label: `SA=${S.SA[i].toFixed(0)}`,
                        data: line, _saIdx: i,
                        borderColor: getColor(i), backgroundColor: 'transparent',
                        pointRadius: 0, showLine: true, borderWidth: 1.5
                    });
                }
            }
            if (S.selectedSA_idx >= 0 && S.selectedV_idx >= 0) {
                datasets.push({
                    label: '选中', _isHighlight: true,
                    data: [{ x: S.V[S.selectedV_idx], y: S.Y[S.selectedSA_idx][S.selectedV_idx] }],
                    borderColor: '#ef4444', backgroundColor: '#ef4444',
                    pointRadius: 10, showLine: false, borderWidth: 3
                });
            }
            charts.YV.data.datasets = datasets;
            charts.YV.update();
        }

        // dY/dV chart
        {
            const datasets = [];
            for (let i = 0; i < S.nSA; i++) {
                const pts = S.V.map((v, j) => ({ x: v, y: S.dY_dV_adj[i][j] }));
                datasets.push({
                    label: `SA=${S.SA[i].toFixed(0)}`,
                    data: pts, _saIdx: i,
                    borderColor: getColor(i), backgroundColor: getColor(i),
                    pointRadius: 4, showLine: false, borderWidth: 0
                });
                if (S.isBuilt) {
                    const line = V_cont.map(v => ({ x: v, y: evalSlopeHermite(S.SA[i], v, 'V') }));
                    datasets.push({
                        label: `SA=${S.SA[i].toFixed(0)}`,
                        data: line, _saIdx: i,
                        borderColor: getColor(i), backgroundColor: 'transparent',
                        pointRadius: 0, showLine: true, borderWidth: 1.5
                    });
                }
            }
            datasets.push({
                label: '', data: [{ x: S.V[0], y: 0 }, { x: S.V[S.nV - 1], y: 0 }],
                borderColor: '#94a3b8', borderDash: [4, 4], pointRadius: 0, showLine: true, borderWidth: 1
            });
            if (S.selectedSA_idx >= 0 && S.selectedV_idx >= 0) {
                datasets.push({
                    label: '选中', _isHighlight: true,
                    data: [{ x: S.V[S.selectedV_idx], y: S.dY_dV_adj[S.selectedSA_idx][S.selectedV_idx] }],
                    borderColor: '#ef4444', backgroundColor: '#ef4444',
                    pointRadius: 10, showLine: false, borderWidth: 3
                });
            }
            charts.SlopeV.data.datasets = datasets;
            charts.SlopeV.update();
        }
    }

    function linspace(a, b, n) {
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(a + (b - a) * i / (n - 1));
        return arr;
    }

    function logspace(logA, logB, n) {
        const arr = [];
        for (let i = 0; i < n; i++) arr.push(Math.pow(10, logA + (logB - logA) * i / (n - 1)));
        return arr;
    }

    /* ============ Bode 分析 ============ */
    function updateBodePlot() {
        if (S.nSA === 0) { alert('请先在 MAP 标定页面导入数据'); return; }
        $('bodeStatus').textContent = '状态: 正在计算...';
        $('bodeStatus').style.color = '#d97706';

        setTimeout(() => {
            try {
                const p = readBodeParams();
                const f = logspace(-1, 2, 500);
                const w = f.map(fi => 2 * Math.PI * fi);
                const TWO_PI = 2 * Math.PI;
                const u_mps = S.V.map(v => v / 3.6);

                const ginvmag = [], ginvphase = [];
                const hmagData = [], hphaseData = [];
                const gtotalmag = [], gtotalphase = [];

                for (let i = 0; i < u_mps.length; i++) {
                    const vx = u_mps[i], u2 = vx * vx;
                    const ginvM = [], ginvP = [];
                    const hM = [], hP = [];
                    const gtM = [], gtP = [];

                    for (let k = 0; k < w.length; k++) {
                        // G_inv
                        const ginv = evalGinvComplex(p, vx, u2, w[k], TWO_PI);
                        ginvM.push(20 * Math.log10(Math.max(cAbs(ginv), 1e-30)));
                        ginvP.push(cAngle(ginv));

                        // H
                        const h = evalHComplex(p, vx, u2, w[k]);
                        hM.push(20 * Math.log10(Math.max(cAbs(h), 1e-30)));
                        hP.push(cAngle(h));

                        // G_total = G_inv * H
                        const gt = cMul(ginv, h);
                        gtM.push(20 * Math.log10(Math.max(cAbs(gt), 1e-30)));
                        gtP.push(cAngle(gt));
                    }

                    ginvmag.push({ v: S.V[i], data: ginvM });
                    ginvphase.push({ v: S.V[i], data: ginvP });
                    hmagData.push({ v: S.V[i], data: hM });
                    hphaseData.push({ v: S.V[i], data: hP });
                    gtotalmag.push({ v: S.V[i], data: gtM });
                    gtotalphase.push({ v: S.V[i], data: gtP });
                }

                renderBodeMagChart(charts.GinvMag, ginvmag, f);
                renderBodePhaseChart(charts.GinvPhase, ginvphase, f);
                renderBodeMagChart(charts.HMag, hmagData, f);
                renderBodePhaseChart(charts.HPhase, hphaseData, f);
                renderBodeMagChart(charts.GtotalMag, gtotalmag, f);
                renderBodePhaseChart(charts.GtotalPhase, gtotalphase, f);

                // Ensure proper sizing after render
                setTimeout(() => {
                    [charts.GinvMag, charts.GinvPhase, charts.HMag, charts.HPhase, charts.GtotalMag, charts.GtotalPhase].forEach(c => {
                        c.resize();
                        c.update('none');
                    });
                }, 100);

                $('bodeStatus').textContent = '状态: Bode 分析完成';
                $('bodeStatus').style.color = '#16a34a';
            } catch (err) {
                console.error(err);
                alert('Bode 计算出错: ' + err.message);
                $('bodeStatus').textContent = '状态: 计算出错';
                $('bodeStatus').style.color = '#dc2626';
            }
        }, 10);
    }

    function readBodeParams() {
        return {
            m_inv: val('m_inv'), Cf_inv: val('Cf_inv'), Cr_inv: val('Cr_inv'),
            a_inv: val('a_inv'), b_inv: val('b_inv'), Iz_inv: val('Iz_inv'),
            m_trans: val('m_trans'), Cf_trans: val('Cf_trans'), Cr_trans: val('Cr_trans'),
            a_trans: val('a_trans'), b_trans: val('b_trans'), Iz_trans: val('Iz_trans'),
            FreqBW: val('FreqBW'), zetaC: val('zetaC')
        };
    }

    function val(id) { return parseFloat($(id).value); }

    function calcGinvCoeffs(p, vx, u2, TWO_PI) {
        const L_inv = p.a_inv + p.b_inv;
        const zc = p.zetaC, zc2 = zc * zc, zc4 = zc2 * zc2;
        const inner = 2.0 - 4.0 * zc2 + 4.0 * zc4;
        const bracket = 1.0 - 2.0 * zc2 + Math.sqrt(Math.max(inner, 0));
        const scale = Math.sqrt(Math.max(bracket, 1e-12));
        const wc = (TWO_PI * p.FreqBW) / scale;
        const wc2 = wc * wc;
        const N1c = (p.Cf_inv + p.Cr_inv) / (p.m_inv * vx) + (p.a_inv * p.a_inv * p.Cf_inv + p.b_inv * p.b_inv * p.Cr_inv) / (p.Iz_inv * vx);
        const N0c = p.Cf_inv * p.Cr_inv * L_inv * L_inv / (p.Iz_inv * p.m_inv * u2) - (p.a_inv * p.Cf_inv - p.b_inv * p.Cr_inv) / p.Iz_inv;
        const p_coef = (p.a_inv * p.Cf_inv) / p.Iz_inv;
        const q_coef = (p.Cf_inv * p.Cr_inv * L_inv) / (p.Iz_inv * p.m_inv * vx);
        return { wc, wc2, N1c, N0c, p_coef, q_coef, L_inv };
    }

    // Complex number operations
    function cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
    function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
    function cDiv(a, b) {
        const d = b.re * b.re + b.im * b.im;
        if (d < 1e-30) return { re: 0, im: 0 };
        return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
    }
    function cAbs(a) { return Math.sqrt(a.re * a.re + a.im * a.im); }
    function cAngle(a) { return Math.atan2(a.im, a.re) * 180 / Math.PI; }

    function evalGinvComplex(p, vx, u2, w, TWO_PI) {
        const { wc, wc2, N1c, N0c, p_coef, q_coef } = calcGinvCoeffs(p, vx, u2, TWO_PI);
        const zc = p.zetaC;
        const s = { re: 0, im: w };
        const s2 = cMul(s, s);
        const s3 = cMul(s2, s);

        const num = cAdd(cAdd(
            { re: wc2 * s2.re, im: wc2 * s2.im },
            { re: wc2 * N1c * s.re, im: wc2 * N1c * s.im }
        ), { re: wc2 * N0c, im: 0 });

        const c3 = p_coef;
        const c2 = 2 * p_coef * zc * wc + q_coef;
        const c1 = p_coef * wc2 + 2 * q_coef * zc * wc;
        const c0 = q_coef * wc2;

        const den = cAdd(cAdd(cAdd(
            { re: c3 * s3.re, im: c3 * s3.im },
            { re: c2 * s2.re, im: c2 * s2.im }
        ), { re: c1 * s.re, im: c1 * s.im }), { re: c0, im: 0 });

        return cDiv(num, den);
    }

    function evalHComplex(p, vx, u2, w) {
        const L_trans = p.a_trans + p.b_trans;
        const N1 = p.a_trans * p.Cf_trans * p.m_trans * u2;
        const N0 = p.Cf_trans * p.Cr_trans * L_trans * vx;
        const D2 = p.Iz_trans * p.m_trans * u2;
        const D1 = vx * (p.Iz_trans * (p.Cf_trans + p.Cr_trans) + p.m_trans * (p.a_trans * p.a_trans * p.Cf_trans + p.b_trans * p.b_trans * p.Cr_trans));
        const D0 = p.Cf_trans * p.Cr_trans * L_trans * L_trans - p.m_trans * u2 * (p.a_trans * p.Cf_trans - p.b_trans * p.Cr_trans);
        const uLCfCr = vx * L_trans * p.Cf_trans * p.Cr_trans;

        if (Math.abs(uLCfCr) < 1e-12 || Math.abs(D0) < 1e-12) {
            return { re: 1, im: 0 };
        }
        const Gss_inv = D0 / uLCfCr;

        const s = { re: 0, im: w };
        const s2 = cMul(s, s);

        const num = cAdd(
            { re: N1 * Gss_inv * s.re, im: N1 * Gss_inv * s.im },
            { re: N0 * Gss_inv, im: 0 }
        );

        const den = cAdd(cAdd(
            { re: D2 * s2.re, im: D2 * s2.im },
            { re: D1 * s.re, im: D1 * s.im }
        ), { re: D0, im: 0 });

        return cDiv(num, den);
    }

    function renderBodeMagChart(chart, dataArr, fArr) {
        const datasets = [];
        for (let i = 0; i < dataArr.length; i++) {
            const pts = [];
            for (let k = 0; k < fArr.length; k++) {
                pts.push({ x: fArr[k], y: dataArr[i].data[k] });
            }
            datasets.push({
                label: `V=${dataArr[i].v.toFixed(0)}`,
                data: pts, borderColor: getColor(i), backgroundColor: 'transparent',
                pointRadius: 0, showLine: true, borderWidth: 1.5
            });
        }
        chart.data.datasets = datasets;
        chart.update();
    }

    function renderBodePhaseChart(chart, dataArr, fArr) {
        const datasets = [];
        for (let i = 0; i < dataArr.length; i++) {
            const pts = [];
            for (let k = 0; k < fArr.length; k++) {
                pts.push({ x: fArr[k], y: dataArr[i].data[k] });
            }
            datasets.push({
                label: `V=${dataArr[i].v.toFixed(0)}`,
                data: pts, borderColor: getColor(i), backgroundColor: 'transparent',
                pointRadius: 0, showLine: true, borderWidth: 1.5
            });
        }
        chart.data.datasets = datasets;
        chart.update();
    }

    /* ============ 前轮转角 MAP ============ */
    function generateSteeringMap() {
        if (S.nSA === 0) { alert('请先在 MAP 标定页面导入数据'); return; }
        $('steerStatus').textContent = '状态: 正在计算前轮转角 MAP...';
        $('steerStatus').style.color = '#d97706';

        setTimeout(() => {
            try {
                // 读取 steer 页面的参数
                const p = {
                    m_inv: parseFloat($('steer_m').value),
                    Cf_inv: parseFloat($('steer_Cf').value),
                    Cr_inv: parseFloat($('steer_Cr').value),
                    a_inv: parseFloat($('steer_a').value),
                    b_inv: parseFloat($('steer_b').value),
                    Iz_inv: parseFloat($('steer_Iz').value),
                    FreqBW: parseFloat($('steer_FreqBW').value),
                    zetaC: parseFloat($('steer_zetaC').value),
                    m_trans: parseFloat($('steer_m').value),
                    Cf_trans: parseFloat($('steer_Cf').value),
                    Cr_trans: parseFloat($('steer_Cr').value),
                    a_trans: parseFloat($('steer_a').value),
                    b_trans: parseFloat($('steer_b').value),
                    Iz_trans: parseFloat($('steer_Iz').value)
                };
                const TWO_PI = 2 * Math.PI;
                const f_target = 0.01;
                const w_target = TWO_PI * f_target;

                const delta_gtotal = [];
                const ratio_MAP = [];
                const G_total_mag_vec = [];

                for (let si = 0; si < S.nSA; si++) { delta_gtotal[si] = []; ratio_MAP[si] = []; }

                for (let jj = 0; jj < S.nV; jj++) {
                    const vx = S.V[jj] / 3.6;
                    const u2 = vx * vx;

                    const Ginv = evalGinvComplex(p, vx, u2, w_target, TWO_PI);
                    const H = evalHComplex(p, vx, u2, w_target);
                    const Gtotal = cMul(Ginv, H);
                    const Gtotal_mag = cAbs(Gtotal);
                    G_total_mag_vec.push(Gtotal_mag);

                    for (let ii = 0; ii < S.nSA; ii++) {
                        const gamma_actual = S.Y[ii][jj];
                        delta_gtotal[ii][jj] = gamma_actual * Gtotal_mag;
                        ratio_MAP[ii][jj] = Math.abs(delta_gtotal[ii][jj]) > 0.001 ?
                            S.SA[ii] / delta_gtotal[ii][jj] : 0;
                    }
                }

                S.steerDelta = delta_gtotal;
                S.steerRatio = ratio_MAP;
                S.steerSA = [...S.SA];
                S.steerV = [...S.V];

                renderSteerPage(delta_gtotal, ratio_MAP, G_total_mag_vec, f_target);

                $('steerStatus').textContent = '状态: 前轮转角 MAP 生成完成';
                $('steerStatus').style.color = '#16a34a';
            } catch (err) {
                console.error(err);
                alert('计算出错: ' + err.message);
                $('steerStatus').textContent = '状态: 计算出错';
                $('steerStatus').style.color = '#dc2626';
            }
        }, 10);
    }

    function renderSteerPage(delta, ratio, Gmag, f_target) {
        const saH = S.SA.map(v => v.toFixed(0));
        const vH = S.V.map(v => v.toFixed(0));

        let gainStr = `|G_total(${f_target}Hz)|: `;
        for (let j = 0; j < S.V.length; j++) gainStr += `V=${S.V[j].toFixed(0)}:${Gmag[j].toFixed(4)} `;
        $('steerGainInfo').textContent = gainStr;

        $('tblSteerWrap').innerHTML = buildTable(transpose(delta), saH, vH, false, 'steer');

        // 前轮转角 vs SA
        {
            const datasets = [];
            for (let j = 0; j < S.nV; j++) {
                datasets.push({
                    label: `V=${S.V[j].toFixed(0)}`,
                    data: S.SA.map((sa, i) => ({ x: sa, y: delta[i][j] })),
                    borderColor: getColor(j), backgroundColor: getColor(j),
                    pointRadius: 4, showLine: true, borderWidth: 1.5
                });
            }
            charts.SteerSA.data.datasets = datasets;
            charts.SteerSA.update();
        }
        // 前轮转角 vs V
        {
            const datasets = [];
            for (let i = 0; i < S.nSA; i++) {
                datasets.push({
                    label: `SA=${S.SA[i].toFixed(0)}`,
                    data: S.V.map((v, j) => ({ x: v, y: delta[i][j] })),
                    borderColor: getColor(i), backgroundColor: getColor(i),
                    pointRadius: 4, showLine: true, borderWidth: 1.5
                });
            }
            charts.SteerV.data.datasets = datasets;
            charts.SteerV.update();
        }
    }

    function generateRatioMap() {
        if (S.nSA === 0) { alert('请先在 MAP 标定页面导入数据'); return; }
        $('ratioStatus').textContent = '状态: 正在计算传动比 MAP...';
        $('ratioStatus').style.color = '#d97706';

        setTimeout(() => {
            try {
                const p = {
                    m_inv: parseFloat($('ratio_m').value),
                    Cf_inv: parseFloat($('ratio_Cf').value),
                    Cr_inv: parseFloat($('ratio_Cr').value),
                    a_inv: parseFloat($('ratio_a').value),
                    b_inv: parseFloat($('ratio_b').value),
                    Iz_inv: parseFloat($('ratio_Iz').value),
                    FreqBW: parseFloat($('ratio_FreqBW').value),
                    zetaC: parseFloat($('ratio_zetaC').value),
                    m_trans: parseFloat($('ratio_m').value),
                    Cf_trans: parseFloat($('ratio_Cf').value),
                    Cr_trans: parseFloat($('ratio_Cr').value),
                    a_trans: parseFloat($('ratio_a').value),
                    b_trans: parseFloat($('ratio_b').value),
                    Iz_trans: parseFloat($('ratio_Iz').value)
                };
                const TWO_PI = 2 * Math.PI;
                const f_target = 0.01;
                const w_target = TWO_PI * f_target;

                const delta_gtotal = [];
                const ratio_MAP = [];
                const G_total_mag_vec = [];

                for (let si = 0; si < S.nSA; si++) { delta_gtotal[si] = []; ratio_MAP[si] = []; }

                for (let jj = 0; jj < S.nV; jj++) {
                    const vx = S.V[jj] / 3.6;
                    const u2 = vx * vx;

                    const Ginv = evalGinvComplex(p, vx, u2, w_target, TWO_PI);
                    const H = evalHComplex(p, vx, u2, w_target);
                    const Gtotal = cMul(Ginv, H);
                    const Gtotal_mag = cAbs(Gtotal);
                    G_total_mag_vec.push(Gtotal_mag);

                    for (let ii = 0; ii < S.nSA; ii++) {
                        const gamma_actual = S.Y[ii][jj];
                        delta_gtotal[ii][jj] = gamma_actual * Gtotal_mag;
                        ratio_MAP[ii][jj] = Math.abs(delta_gtotal[ii][jj]) > 0.001 ?
                            S.SA[ii] / delta_gtotal[ii][jj] : 0;
                    }
                }

                S.steerRatio = ratio_MAP;
                S.steerSA = [...S.SA];
                S.steerV = [...S.V];

                renderRatioPage(ratio_MAP, G_total_mag_vec, f_target);

                $('ratioStatus').textContent = '状态: 传动比 MAP 生成完成';
                $('ratioStatus').style.color = '#16a34a';
            } catch (err) {
                console.error(err);
                alert('计算出错: ' + err.message);
                $('ratioStatus').textContent = '状态: 计算出错';
                $('ratioStatus').style.color = '#dc2626';
            }
        }, 10);
    }

    function renderRatioPage(ratio, Gmag, f_target) {
        const saH = S.SA.map(v => v.toFixed(0));
        const vH = S.V.map(v => v.toFixed(0));

        let gainStr = `|G_total(${f_target}Hz)|: `;
        for (let j = 0; j < S.V.length; j++) gainStr += `V=${S.V[j].toFixed(0)}:${Gmag[j].toFixed(4)} `;
        $('ratioGainInfo').textContent = gainStr;

        $('tblRatioWrap').innerHTML = buildTable(transpose(ratio), saH, vH, false, 'ratio');

        // 传动比 vs SA
        {
            const datasets = [];
            for (let j = 0; j < S.nV; j++) {
                datasets.push({
                    label: `V=${S.V[j].toFixed(0)}`,
                    data: S.SA.map((sa, i) => ({ x: sa, y: ratio[i][j] })),
                    borderColor: getColor(j), backgroundColor: getColor(j),
                    pointRadius: 4, showLine: true, borderWidth: 1.5
                });
            }
            charts.RatioSA.data.datasets = datasets;
            charts.RatioSA.update();
        }
        // 传动比 vs V
        {
            const datasets = [];
            for (let i = 0; i < S.nSA; i++) {
                datasets.push({
                    label: `SA=${S.SA[i].toFixed(0)}`,
                    data: S.V.map((v, j) => ({ x: v, y: ratio[i][j] })),
                    borderColor: getColor(i), backgroundColor: getColor(i),
                    pointRadius: 4, showLine: true, borderWidth: 1.5
                });
            }
            charts.RatioV.data.datasets = datasets;
            charts.RatioV.update();
        }
    }

    function resetRatioParams() {
        $('ratio_m').value = '2914';
        $('ratio_Cf').value = '177936';
        $('ratio_Cr').value = '323205';
        $('ratio_a').value = '1.492';
        $('ratio_b').value = '1.508';
        $('ratio_Iz').value = '5308';
        $('ratio_FreqBW').value = '10';
        $('ratio_zetaC').value = '1.3';
        $('ratioStatus').textContent = '状态: 参数已重置';
        $('ratioStatus').style.color = '#16a34a';
    }

    function resetSteerParams() {
        $('steer_m').value = '2914';
        $('steer_Cf').value = '177936';
        $('steer_Cr').value = '323205';
        $('steer_a').value = '1.492';
        $('steer_b').value = '1.508';
        $('steer_Iz').value = '5308';
        $('steer_FreqBW').value = '10';
        $('steer_zetaC').value = '1.3';
        $('steerStatus').textContent = '状态: 参数已重置';
        $('steerStatus').style.color = '#16a34a';
    }

    /* ============ 导出功能 ============ */
    function exportMAP() {
        if (!S.isBuilt) { alert('请先构建曲面'); return; }
        const nSA_out = 21, nV_out = 15;
        const SA_out = linspace(S.SA[0], S.SA[S.nSA - 1], nSA_out);
        const V_out = linspace(S.V[0], S.V[S.nV - 1], nV_out);

        let csv = 'V/SA';
        for (const sa of SA_out) csv += `,${sa.toFixed(1)}`;
        csv += '\n';

        for (const v of V_out) {
            csv += v.toFixed(1);
            for (const sa of SA_out) csv += `,${evalHermite(sa, v).toFixed(4)}`;
            csv += '\n';
        }
        downloadCSV(csv, 'yawrate_map.csv');
    }

    function exportYCSV() {
        if (S.nSA === 0) return;
        let csv = 'V/SA';
        for (const sa of S.SA) csv += `,${sa.toFixed(0)}`;
        csv += '\n';
        for (let vi = 0; vi < S.nV; vi++) {
            csv += S.V[vi].toFixed(0);
            for (let si = 0; si < S.nSA; si++) csv += `,${S.Y[si][vi].toFixed(4)}`;
            csv += '\n';
        }
        downloadCSV(csv, 'yawrate_Y_values.csv');
    }

    function exportAdjustedSlopeCSV() {
        if (S.nSA === 0) return;
        let csv = 'dY/dSA\nV/SA';
        for (const sa of S.SA) csv += `,${sa.toFixed(0)}`;
        csv += '\n';
        for (let vi = 0; vi < S.nV; vi++) {
            csv += S.V[vi].toFixed(0);
            for (let si = 0; si < S.nSA; si++) csv += `,${S.dY_dSA_adj[si][vi].toFixed(4)}`;
            csv += '\n';
        }
        csv += '\ndY/dV\nV/SA';
        for (const sa of S.SA) csv += `,${sa.toFixed(0)}`;
        csv += '\n';
        for (let vi = 0; vi < S.nV; vi++) {
            csv += S.V[vi].toFixed(0);
            for (let si = 0; si < S.nSA; si++) csv += `,${S.dY_dV_adj[si][vi].toFixed(4)}`;
            csv += '\n';
        }
        downloadCSV(csv, 'yawrate_adjusted_slopes.csv');
    }

    function exportExcelCSV() {
        if (S.nSA === 0) return;
        exportYCSV(); // Same format
    }

    function exportSteeringCSV() {
        if (!S.steerDelta) return;
        let csv = 'V/SA';
        for (const sa of S.steerSA) csv += `,${sa.toFixed(0)}`;
        csv += '\n';
        for (let vi = 0; vi < S.steerV.length; vi++) {
            csv += S.steerV[vi].toFixed(0);
            for (let si = 0; si < S.steerSA.length; si++) csv += `,${S.steerDelta[si][vi].toFixed(6)}`;
            csv += '\n';
        }
        downloadCSV(csv, 'steering_angle_map.csv');
    }

    function exportRatioCSV() {
        if (!S.steerRatio) return;
        let csv = 'V/SA';
        for (const sa of S.steerSA) csv += `,${sa.toFixed(0)}`;
        csv += '\n';
        for (let vi = 0; vi < S.steerV.length; vi++) {
            csv += S.steerV[vi].toFixed(0);
            for (let si = 0; si < S.steerSA.length; si++) csv += `,${S.steerRatio[si][vi].toFixed(4)}`;
            csv += '\n';
        }
        downloadCSV(csv, 'steering_ratio_map.csv');
    }

    function downloadCSV(content, filename) {
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /* ============ Bode 参数重置 ============ */
    function resetBodeParams() {
        $('m_inv').value = '2914';
        $('Cf_inv').value = '177936';
        $('Cr_inv').value = '323205';
        $('a_inv').value = '1.492';
        $('b_inv').value = '1.508';
        $('Iz_inv').value = '5308';
        $('m_trans').value = '2914';
        $('Cf_trans').value = '177936';
        $('Cr_trans').value = '323205';
        $('a_trans').value = '1.492';
        $('b_trans').value = '1.508';
        $('Iz_trans').value = '5771.52';
        $('FreqBW').value = '10';
        $('zetaC').value = '1.3';
        $('bodeStatus').textContent = '状态: 参数已重置';
        $('bodeStatus').style.color = '#16a34a';
    }

    /* ============ 初始化 ============ */
    document.addEventListener('DOMContentLoaded', init);

    /* ============ 公开 API ============ */
    return { adjustYValues, setSinglePointSlope, resetSteerParams, resetRatioParams, exportSteeringCSV, exportRatioCSV };
})();
