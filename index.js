import Map from "ol/Map.js";
import OSM from "ol/source/OSM.js";
import TileLayer from "ol/layer/Tile.js";
import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import View from "ol/View.js";
import { useGeographic } from "ol/proj";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";

useGeographic();

const CLICK_STYLE = {
  "circle-radius": 7,
  "circle-fill-color": "rgba(255, 0, 0, 0.5)",
  "circle-stroke-color": "rgba(255, 0, 0, 1)",
  "circle-stroke-width": 2,
};

const NODE_STYLE = {
  "circle-radius": 7,
  "circle-fill-color": "rgba(0, 153, 51, 0.5)",
  "circle-stroke-color": "rgba(0, 153, 51, 1)",
  "circle-stroke-width": 2,
};

const SEGMENT_STYLE = {
  "stroke-color": "rgb(0, 153, 51)",
  "stroke-width": 4,
};

function createLayer(layerArgs = {}, sourceArgs = {}) {
  return new VectorLayer({
    source: new VectorSource({ ...sourceArgs }),
    ...layerArgs,
  });
}

function pointFromCoordinates(coords) {
  return new Feature({ geometry: new Point(coords) });
}

function lineFromCoordinates(coords) {
  return new Feature({ geometry: new LineString(coords) });
}

function makeValhallaLocation(coords) {
  return { lat: coords[1], lon: coords[0] };
}
function decodePolyline(str, precision) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  let shift = 0;
  let result = 0;
  let byte = null;
  let latitude_change;
  let longitude_change;

  const factor = Math.pow(10, precision || 6);

  // Coordinates have variable length when encoded, so just keep
  // track of whether we've hit the end of the string. In each
  // loop iteration, a single coordinate is decoded.
  while (index < str.length) {
    // Reset shift, result, and byte
    byte = null;
    shift = 0;
    result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    latitude_change = result & 1 ? ~(result >> 1) : result >> 1;

    shift = result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    longitude_change = result & 1 ? ~(result >> 1) : result >> 1;

    lat += latitude_change;
    lng += longitude_change;

    coordinates.push([lng / factor, lat / factor]);
  }

  return coordinates;
}

const clickedLocationLayer = createLayer({ style: CLICK_STYLE });
const nodeLayer = createLayer({ style: NODE_STYLE });
const segmentLayer = createLayer({ style: SEGMENT_STYLE });

const map = new Map({
  layers: [
    new TileLayer({
      source: new OSM(),
    }),
    segmentLayer,
    clickedLocationLayer,
    nodeLayer,
  ],
  target: "map",
  view: new View({
    center: [8, 47],
    zoom: 11,
  }),
});

async function handleClick(e) {
  // add clicked location
  const feature = pointFromCoordinates(e.coordinate);
  clickedLocationLayer.getSource().clear();
  clickedLocationLayer.getSource().addFeature(feature);

  // get valhalla locate response
  const res = await fetch("http://localhost:8002/locate", {
    method: "POST",
    body: JSON.stringify({
      locations: [makeValhallaLocation(e.coordinate)],
      costing: "auto",
      verbose: true,
      road_segments: true,
    }),
  });

  const json = await res.json();

  if (!json[0].edges) {
    return;
  }

  for (const edge of json[0].edges) {
    const seg = edge.full_road_segment;
    const geom = decodePolyline(seg.shape);
    segmentLayer.getSource().clear();
    segmentLayer.getSource().addFeature(lineFromCoordinates(geom));

    // add nodes as well
    nodeLayer.getSource().clear();
    const sn = seg.intersections.start_node;
    const en = seg.intersections.end_node;
    console.log(en);
    nodeLayer
      .getSource()
      .addFeature(pointFromCoordinates([sn.node.lon, sn.node.lat]));
    nodeLayer
      .getSource()
      .addFeature(pointFromCoordinates([en.node.lon, en.node.lat]));
  }
}

map.on("click", handleClick);
