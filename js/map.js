/* ============================================================
   EcoGridMap — Leaflet map with layer toggles and band-colored
   site markers. Raster tiles are dark-tinted via a single CSS
   filter (see styles.css .map-dark) instead of a vector tile
   stack — a green-software tradeoff.
   ============================================================ */
(function () {
  "use strict";

  const BAND_COLORS = {
    recommended: "#34d399",
    viable: "#38bdf8",
    marginal: "#fbbf24",
    notrec: "#fb7185"
  };

  const BASEMAPS = {
    osm: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    },
    topo: {
      url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attr: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Style: <a href="https://opentopomap.org">&copy; OpenTopoMap</a>',
      maxZoom: 17
    }
  };

  let map, layers = {}, markers = {}, onSelectCb;

  function init(onSelect) {
    onSelectCb = onSelect;
    map = L.map("map", { center: [20.55, 85.6], zoom: 8, zoomControl: true, attributionControl: true });
    setBasemap("osm");

    layers.highways = L.geoJSON(null, {
      style: f => ({
        color: f.properties.class === "NH" ? "#f59e0b" : "#a78bfa",
        weight: f.properties.class === "NH" ? 4 : 2.5,
        opacity: 0.85
      }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindPopup(
          `<b>${p.name}</b><div class="popup-rows">
            <dt>Class</dt><dd>${p.class} · ${p.lanes} lanes</dd>
            <dt>AADT 2026</dt><dd>${p.aadt2026.toLocaleString()} veh/day</dd>
            <dt>Heavy vehicles</dt><dd>${p.heavyVehiclePct}%</dd>
            <dt>Seasonality</dt><dd>${p.seasonalNote}</dd></div>`
        );
      }
    });
    layers.substations = L.geoJSON(null, {
      pointToLayer: (f, latlng) => L.marker(latlng, {
        icon: L.divIcon({
          className: "",
          html: '<div style="width:16px;height:16px;border:2px solid #7dd3fc;background:rgba(7,89,133,.55);transform:rotate(45deg);border-radius:2px"></div>',
          iconSize: [16, 16], iconAnchor: [8, 8]
        })
      }),
      onEachFeature: (f, lyr) => {
        const p = f.properties;
        lyr.bindPopup(
          `<b>${p.name} substation</b><div class="popup-rows">
            <dt>ID</dt><dd>${p.id}</dd>
            <dt>Voltage</dt><dd>${p.voltage}</dd>
            <dt>Capacity</dt><dd>${p.capacityMva} MVA</dd>
            <dt>Peak loading</dt><dd>${p.peakLoadingPct}%</dd>
            <dt>Feeders</dt><dd>${p.feeders}</dd></div>`
        );
      }
    });
    layers.sites = L.geoJSON(null, { pointToLayer: pointToSiteMarker });
  }

  function pointToSiteMarker(f, latlng) {
    const p = f.properties;
    const band = p._band || "viable";
    const color = BAND_COLORS[band];
    const sel = p._selected;
    const icon = L.divIcon({
      className: "",
      html: `<div style="width:${sel ? 20 : 14}px;height:${sel ? 20 : 14}px;background:${color};border:2px solid #0a111f;border-radius:50%;box-shadow:0 0 0 ${sel ? 5 : 2}px ${color}44"></div>`,
      iconSize: [sel ? 24 : 18, sel ? 24 : 18],
      iconAnchor: [sel ? 12 : 9, sel ? 12 : 9]
    });
    const m = L.marker(latlng, { icon, zIndexOffset: sel ? 1000 : 0 });
    m.bindPopup(sitePopup(p));
    m.on("click", () => { if (onSelectCb) onSelectCb(p.id); });
    markers[p.id] = m;
    return m;
  }

  function sitePopup(p) {
    const pct = p._percent != null ? p._percent : "—";
    return `<b>${p.id} · ${p.name}</b>
      <div class="popup-rows">
        <dt>Suitability</dt><dd>${pct}/100</dd>
        <dt>Highway</dt><dd>${p.highwayId} · ${p.highwayDistanceM} m</dd>
        <dt>Grid</dt><dd>${p.gridDistanceM} m · ${p.feederVoltage}</dd>
        <dt>Parcel</dt><dd>${p.parcelAreaSqM.toLocaleString()} m² · ${p.landUse}</dd>
        <dt>Config</dt><dd>${p.chargerCount} × 240 kW DC</dd>
        <dt>Capex</dt><dd>₹${p.estimatedCapexInrCrore} Cr</dd>
        <dt>Status</dt><dd>${p.status}</dd>
      </div>`;
  }

  function setSiteData(scored) {
    const feats = scored.map(s => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: s.props._coords },
      properties: Object.assign({}, s.props, {
        _band: s.classification.key,
        _percent: s.percent,
        _selected: s.id === s._selectedId
      })
    }));
    layers.sites.clearLayers();
    markers = {};
    layers.sites.addData({ type: "FeatureCollection", features: feats });
  }

  function setSelected(id) {
    layers.sites.eachLayer(lyr => {
      const p = lyr.feature.properties;
      if (markers[p.id]) {
        const band = BAND_COLORS[p._band];
        const sel = p.id === id;
        lyr.setIcon(L.divIcon({
          className: "",
          html: `<div style="width:${sel ? 20 : 14}px;height:${sel ? 20 : 14}px;background:${band};border:2px solid #0a111f;border-radius:50%;box-shadow:0 0 0 ${sel ? 5 : 2}px ${band}44"></div>`,
          iconSize: [sel ? 24 : 18, sel ? 24 : 18],
          iconAnchor: [sel ? 12 : 9, sel ? 12 : 9]
        }));
        lyr.setZIndexOffset(sel ? 1000 : 0);
      }
    });
  }

  function setBasemap(key) {
    if (map._basemap) map.removeLayer(map._basemap);
    const b = BASEMAPS[key] || BASEMAPS.osm;
    map._basemap = L.tileLayer(b.url, { attribution: b.attr, maxZoom: b.maxZoom });
    map._basemap.addTo(map);
    const c = document.getElementById("map");
    if (c) c.classList.toggle("map-dark", key === "osm");
  }

  function setLayerVisible(name, visible) {
    const lyr = layers[name];
    if (!lyr) return;
    if (visible) { if (!map.hasLayer(lyr)) lyr.addTo(map); }
    else if (map.hasLayer(lyr)) map.removeLayer(lyr);
  }

  function flyToSite(id) {
    const m = markers[id];
    if (m) {
      map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 12), { duration: 0.7 });
      m.openPopup();
    }
  }

  function invalidateSize() { if (map) setTimeout(() => map.invalidateSize(), 60); }

  window.EcoGridMap = { BAND_COLORS, init, setSiteData, setSelected, setBasemap, setLayerVisible, flyToSite, invalidateSize };
})();
