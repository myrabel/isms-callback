"use strict";
require("./loadConfig.js");
const axios = require("axios");
// const gql = require('graphql-tag');

const { Pool, Client } = require("pg");
var pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const Hapi = require("@hapi/hapi");

const start = async () => {
  const server = Hapi.server({
    host: process.env.HOST || "0.0.0.0",
    port: process.env.PORT || 8080
  });
  await server.register(require("@hapi/vision"));

  server.views({
    engines: {
      html: require("handlebars")
    },
    relativeTo: __dirname,
    path: "views"
  });

  server.route({
    method: "GET",
    path: "/",
    handler: handlers.home
  });
  server.route({
    method: "POST",
    path: "/uplink",
    handler: handlers.uplinkCallback
  });
  server.route({
    method: "POST",
    path: "/downlink",
    handler: handlers.downlinkCallback
  });
  await server.start();

  console.log("Server running at:", server.info.uri);
};

start();

const handlers = {
  home: (request, h) => {
    return pool
      .query("select * from callbacks order by date desc")
      .then(res => {
        // console.log(res)
        return h.view("list", { rows: res.rows });
      })
      .catch(e => {
        console.log(e.stack);
        return "Something went wrong:(";
      });
  },
  uplinkCallback: (request, h) => {
    console.log(request.payload);
    // TODO: Forward to our data api
    recordCallback("data/uplink", request);
    return h.response("Callback received").code(200);
  },
  downlinkCallback: (request, h) => {
    return insertCallback("data/downlink", request)
      .then(res => {
        let recordId = res.rows.pop().id;
        console.log("• New record #", recordId);
        var downlinkData = new Number(recordId).toString(16);
        while (downlinkData.length < 16) downlinkData = "0" + downlinkData;
        return h
          .response({
            [request.payload.device]: {
              downlinkData: getDownlinkString(
                recordId,
                request.payload.station,
                request.payload.rssi
              )
            }
          })
          .code(200);
      })
      .catch(err => {
        let msg = "An error occurred while handling the downlink callbacks";
        console.log(msg);
        console.log(err.stack);
        return h.response(msg).code(500);
      });
  }
};
const insertCallback = (type, request) => {
  const qry =
    "INSERT INTO callbacks(date, type, device, data, stationId, rssi, duplicate) VALUES(now(), $1, $2, $3, $4, $5, $6) RETURNING id";
  return pool.query(qry, [
    type,
    request.payload.device,
    request.payload.data,
    request.payload.station,
    request.payload.rssi,
    request.payload.duplicate
  ]);
};
const recordCallback = (type, request) => {
  saveToApi(request.payload)
  return insertCallback(type, request)
    .then(res => {
      console.log("• New record #", res.rows.pop().id);
    })
    .catch(err => {
      console.log("SQL Err", err.stack);
    });
};
const getDownlinkString = (number, station, rssi) => {
  //Downlink data is 8 Bytes
  //We'll send a number over 2 bytes, the ID of the Sigfox station over 4 bytes, and the received signal strength on this staiton over the last 2 bytes
  var arr = new ArrayBuffer(8);
  var view = new DataView(arr);
  //Bytes 0-1 : number
  view.setUint16(0, number, false); //Start at byte 0, false = Big Endian
  //Bytes 2-5 : station id. Input is an hex string
  view.setUint32(2, parseInt(station, 16), false);
  //Bytes 6-7 : rssi (signed int)
  view.setInt16(6, rssi, false);
  var response = [];
  for (var i = 0; i < arr.byteLength; i++) {
    var byte = view.getUint8(i, false).toString(16);
    if (byte < 0x10) byte = "0" + byte;
    response.push(byte);
  }
  return response.join("");
};

const saveToApi = async (rawdata) => {
  const rawdata_  = rawdata.reading;
  const rawfillLevel = parseInt(rawdata_.slice(0, 4), 16);
  const rawbatLevel = parseInt(rawdata_.slice(4, 9), 16);
  const fillLevel = (rawfillLevel/100) - 100;
  const batLevel = (rawbatLevel/100) - 100;
  await axios
    .post(process.env.ENDPOINT, {
      query: `
      mutation($data: TelemetryCreateInput!) {
        createTelemetry(data: $data) {
          id
        }
      }`,
      variables: {
       data: {
        rawreading: rawdata.data,
        reading: fillLevel.toFixed(2),
        batlevel: batLevel.toFixed(2),
        station: rawdata.station,
        rssi: rawdata.rssi,
        snr: rawdata.snr,
        avgSnr: rawdata.avgSnr,
        sigfoxid: rawdata.device,
        device: {
          connect: {
            sigfoxid: rawdata.device
          }
        }
       }
      }
    })
    .then(res => console.log(res.data))
    .catch(err => console.log(err));
};
