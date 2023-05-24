import { mongoose } from "mongoose";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { connectDB } from "./MongoModule/mongoConnect.js";
import { insertStationList, insertRoot, insertBlock } from "./MongoModule/insertDocument.js";
import { updateStationList, updateRoot, updateBlock } from "./MongoModule/updateDocument.js";
import { getStationInfo } from "./OpenAPI/stationInfoAPI.js";
import { findStationList, findBlockByPlace } from "./MongoModule/findDocument.js";
import express_session from "express-session";
import mongoose_session from "mongoose-session"
dotenv.config();

const port = 8000;
const { MONGODB_URI } = process.env;
const { AUTHENTICATION_KEY } = process.env;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express_session({
    secret: AUTHENTICATION_KEY,
    resave: false,
    saveUninitialized: false,
    store: mongoose_session(mongoose),
    cookie: { maxAge: (3.6e+6) * 24 }
}))

app.get("/station/getLine", async (req, res) => {
    let stationInfo = {
        stationName: req.body.stationName,
        collectionID: "",
        LineCnt: 0,
        Line: [],
        returnValue: false,
    };

    if (req.body.stationName == "서울") {
        req.body.stationName = "서울역";
    } else if (req.body.stationName == "서울역") {
        stationInfo.stationName = "서울";
    }

    await getStationInfo(req.body.stationName)
        .then((result) => {
            if (result == undefined) {
                res.json({ returnValue: false, errMsg: "역 이름이 아닙니다" });
            } else if (result.list_total_count._text == 1) {
                res.json({ returnValue: false, errMsg: "환승역이 아닙니다" });
            } else {
                stationInfo.LineCnt = result.list_total_count._text;
                stationInfo.returnValue = true;
                stationInfo.collectionID = "no" + result.row[0].STATION_CD._text;
                for (let i = 0; i < stationInfo.LineCnt; i++) {
                    stationInfo.Line.push(result.row[i].LINE_NUM._text.replace("0", ""));
                }
                console.log("------------------------------------");
                console.log("[/station/getLine] success!");
                console.log(stationInfo);
                console.log("------------------------------------");
                res.json(stationInfo);
            }
        })
        .catch((err) => {
            console.log("------------------------------------");
            console.log("[/station/getLine] error!");
            console.log(err);
            console.log("------------------------------------");
            res.json({
                returnValue: false,
                errMsg: "API에 조회가 되지 않습니다.",
            });
        });
});

app.get("/root/getRoot", async (req, res) => {
    // startAt이랑 endAt을 한번 더 검사하는 부분 추가했으면 좋겠음
    let { stationName, collectionID, startAt, endAt, line } = req.body;

    let response = {
        collectionID: collectionID,
        rootID: "",
        returnValue: true,
    };

    let stationInfo;
    let rootInfo = {
        startAt: startAt,
        endAt: endAt,
    };

    let flag = true;

    /* stationList에서 해당 역이 있는 없는지를 판단 */
    await findStationList(mongoose, stationName)
        .then((result) => {
            stationInfo = result;
        })
        .catch((err) => {
            console.log("------------------------------------");
            console.log("[/root/getRoot] error!");
            console.log(err);
            console.log("------------------------------------");
        });

    let newStationInfo;

    if (stationInfo == null) {
        // stationList에 해당 역이 존재하지 않는다.
        newStationInfo = {
            stationName: stationName,
            collectionID: response.collectionID,
            lineInfo: line,
            rootInfo: [
                {
                    startAt: startAt,
                    endAt: endAt,
                    rootID: "",
                },
            ],
        };
    } else {
        // stationList에 해당 역이 존재한다.
        for (let i = 0; i < stationInfo.rootInfo.length; i++) {
            if (
                stationInfo.rootInfo[i].startAt.next == startAt.next &&
                stationInfo.rootInfo[i].endAt.next == endAt.next
            ) {
                // stationList에 해당 역의 데이터에, 해당 루트도 존재한다.
                response.rootID = stationInfo.rootInfo[i].rootID;
                flag = false;
            }
        }
    }

    if (response.rootID == "") {
        // stationList에 해당 역의 데이터에, 해당 루트가 존재하지 않는다.
        await insertRoot(mongoose, rootInfo, response.collectionID).then(
            // 루트를 만들어준다.
            (result) => {
                console.log(result);
                response.rootID = result._id;
            }
        );
    }

    if (newStationInfo != undefined) {
        // stationList에 해당 역의 데이터가 없으니 추가해준다. -> insert
        newStationInfo.rootInfo[0].rootID = response.rootID;
        console.log(newStationInfo);
        insertStationList(mongoose, newStationInfo);
    } else if (flag) {
        // stationList에 해당 역에 대한 데이터는 있으나, 해당 루트에 대한 데이터는 존재하지 않는다. -> update
        let newRootInfo = {
            startAt: startAt,
            endAt: endAt,
            rootID: response.rootInfo[0].rootID,
        };
        updateStationList(mongoose, newRootInfo, stationName);
    }

    console.log("------------------------------------");
    console.log("[/root/getRoot]");
    console.log(response);
    console.log("------------------------------------");

    res.json(response);
});

app.get("/block/getBlock", async (req, res) => {
    const { collectionID, from, to, content } = req.body;
    let response = {
        blockID: "",
        originContent: [],
        returnValue: true,
    };

    let block = await findBlockByPlace(mongoose, collectionID, from, to);

    if (block == null) {
        block = await insertBlock(mongoose, from, to, content, collectionID);
        response.blockID = block._id;
    } else {
        response.blockID = block._id;
        response.originContent = block.content;
    }

    console.log("------------------------------------");
    console.log("[/block/getBlock]");
    console.log(response);
    console.log("------------------------------------");

    res.json(response);
});

app.patch("/block/patchBlock", async (req, res) => {
    const { collectionID, blockID, content } = req.body;
    let response = { returnValue: true };
    await updateBlock(mongoose, collectionID, blockID, content)
        .then((result) => {
            console.log("------------------------------------");
            console.log("[/block/patchBlock]");
            console.log(response);
            console.log("------------------------------------");
            res.json(response);
        })
        .catch((err) => {
            response.returnValue = false;
            response.errMsg = "Block 업데이트 과정에 에러가 발생했습니다.";
            console.log("------------------------------------");
            console.log("[/block/patchBlock]");
            console.log(response);
            console.log(err);
            console.log("------------------------------------");
            res.json(response);
        });
});

app.patch("/root/patchRoot", async (req, res) => {
    const { collectionID, rootID, blockID_List } = req.body;
    let response = { returnValue: true };
    await updateRoot(mongoose, collectionID, rootID, blockID_List)
        .then((result) => {
            console.log("------------------------------------");
            console.log("[/block/patchRoot]");
            console.log(response);
            console.log("------------------------------------");
            res.json(response);
        })
        .catch((err) => {
            response.returnValue = false;
            response.errMsg = "Root 업데이트 과정에 에러가 발생했습니다.";
            console.log("------------------------------------");
            console.log("[/block/patchRoot]");
            console.log(response);
            console.log(err);
            console.log("------------------------------------");
            res.json(response);
        });
});

app.listen(port, () => {
    console.log(`port is listening at ${port}`);
});

connectDB(mongoose, MONGODB_URI);
