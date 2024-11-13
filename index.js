import Map from "ol/Map.js";
import OSM from "ol/source/OSM.js";
import TileLayer from "ol/layer/Tile.js";
import VectorSource from "ol/source/Vector.js";
import VectorLayer from "ol/layer/Vector.js";
import View from "ol/View.js";
import { useGeographic } from "ol/proj.js";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom.js";
import { Link } from "ol/interaction.js";

useGeographic();

function createLayer(layerArgs = {}, sourceArgs = {}) {
  return new VectorLayer({
    source: new VectorSource({ ...sourceArgs }),
    ...layerArgs,
  });
}

function pointFromCoordinates(coords, id) {
  return new Feature({
    id,
    geometry: new Point(coords),
  });
}

function lineFromCoordinates(coords, id) {
  return new Feature({
    id,
    geometry: new LineString(coords),
  });
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

const palette = [
  [0, 63, 92],
  [212, 80, 135],
  [47, 75, 124],
  [249, 93, 106],
  [102, 81, 145],
  [255, 124, 67],
  [160, 81, 149],
  [255, 166, 0],
];

function makeMatchExpression(palette, opacity) {
  const expression = ["match", ["%", ["get", "id"], palette.length]];
  opacity = opacity ?? 1;
  palette.forEach((rgb, i, a) => {
    const color = "rgba(" + rgb.join(", ") + ", " + opacity + ")";
    if (i + 1 < a.length) {
      expression.push(i);
    }
    expression.push(color);
  });
  return expression;
}

const clickedLocationLayer = createLayer({
  style: {
    "circle-radius": 5,
    "circle-fill-color": "rgba(255, 0, 0, 0.5)",
    "circle-stroke-color": "rgba(255, 0, 0, 1)",
    "circle-stroke-width": 2,
  },
});
const nodeLayer = createLayer({
  style: [
    {
      style: {
        "circle-radius": ["match", ["%", ["get", "id"], 2], 0, 12, 7],
        "circle-fill-color": makeMatchExpression(palette, 0.5),
        "circle-stroke-color": makeMatchExpression(palette),
        "circle-stroke-width": 2,
      },
    },
  ],
});
const segmentLayer = createLayer({
  style: [
    {
      style: {
        "stroke-color": makeMatchExpression(palette, 0.7),
        "stroke-width": ["match", ["%", ["get", "id"], 2], 0, 7, 3],
      },
    },
  ],
});

const map = new Map({
  layers: [
    new TileLayer({
      source: new OSM(),
    }),
    segmentLayer,
    nodeLayer,
    clickedLocationLayer,
  ],
  target: "map",
  view: new View({
    center: [8, 47],
    zoom: 11,
  }),
});
map.addInteraction(new Link());

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
      radius: 1,
      node_snap_tolerance: 0,
    }),
  });

  nodeLayer.getSource().clear();
  segmentLayer.getSource().clear();

  const json = await res.json();

  if (!json[0].edges) {
    return;
  }

  const nodes = [];
  const segments = [];
  let id = -1;
  for (const edge of json[0].edges) {
    ++id;
    const seg = edge.full_road_segment;
    console.log(seg.percent_along);
    if (seg.shape) {
      const geom = decodePolyline(seg.shape);
      segments.push(lineFromCoordinates(geom, id));
    }

    // add nodes as well
    if (seg.intersections) {
      const sn = seg.intersections.start_node;
      const en = seg.intersections.end_node;
      console.log(en);
      nodes.push(
        pointFromCoordinates([sn.node.lon, sn.node.lat], id),
        pointFromCoordinates([seg.mid_point.lon, seg.mid_point.lat], id),
        pointFromCoordinates([en.node.lon, en.node.lat], id)
      );
    }
  }

  nodeLayer.getSource().addFeatures(nodes);
  segmentLayer.getSource().addFeatures(segments);
}

map.on("click", handleClick);
