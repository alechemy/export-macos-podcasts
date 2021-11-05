import { promises as fs } from "fs";
import { promisify } from "util";
import sqlite3 from "sqlite3";
import mm from "music-metadata";
import "path";
import { exec } from "child_process";
import groupBy from "lodash-es/groupBy.js";
import { Promise as NodeID3 } from "node-id3";
import sanitize from "sanitize-filename";

const podcastSelectSQL = `
  SELECT zcleanedtitle as zcleanedtitle, ZMTEPISODE.zuuid as zuuid, ZMTPODCAST.ztitle as ztitle
    FROM ZMTEPISODE, ZMTPODCAST
    WHERE ZMTEPISODE.zpodcastuuid = ZMTPODCAST.zuuid;
`;

function getOutputDirPath() {
  const d = new Date();
  const pad = (s) => s.toString().padStart(2, "0");
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  // const currentDateFolder = `${d.getFullYear()}.${month}.${day}`;
  return "/Volumes/SD_CARD/LEARNING";
}

async function getPodcastsBasePath() {
  const groupContainersFolder = `${process.env.HOME}/Library/Group Containers`;
  try {
    const libraryGroupContainersDirList = await fs.readdir(
      groupContainersFolder
    );
    const podcastsAppFolder = libraryGroupContainersDirList.find((d) =>
      d.includes("groups.com.apple.podcasts")
    );
    if (!podcastsAppFolder) {
      throw new Error(
        `Could not find podcasts app folder in ${groupContainersFolder}`
      );
    }
    return `${process.env.HOME}/Library/Group Containers/${podcastsAppFolder}`;
  } catch (e) {
    throw new Error(
      `Could not find podcasis app folder in ${groupContainersFolder}, original error: ${e}`
    );
  }
}

async function getPodcastsDBPath() {
  return `${await getPodcastsBasePath()}/Documents/MTLibrary.sqlite`;
}

async function getPodcastsCacheFilesPath() {
  return `${await getPodcastsBasePath()}/Library/Cache`;
}

async function getDBPodcastsData() {
  const dbOrigin = new sqlite3.Database(await getPodcastsDBPath());
  const db = {
    serialize: promisify(dbOrigin.serialize).bind(dbOrigin),
    all: promisify(dbOrigin.all).bind(dbOrigin),
    close: promisify(dbOrigin.close).bind(dbOrigin),
  };

  try {
    await db.serialize();
    return await db.all(podcastSelectSQL);
  } finally {
    try {
      db.close();
    } catch {}
  }
}

async function tryGetDBPodcastsData() {
  try {
    return await getDBPodcastsData();
  } catch (error) {
    console.error("Could not fetch data from podcasts database:", error);
    return [];
  }
}

async function getMP3MetaTitle(path) {
  const mp3Metadata = await mm.parseFile(path);
  return mp3Metadata?.common?.title;
}

async function getPodcastsCacheMP3Files(cacheFilesPath) {
  try {
    const podcastFiles = await fs.readdir(cacheFilesPath);
    return podcastFiles.filter((f) => f.includes(".mp3"));
  } catch (e) {
    throw new Error(`Could not find mp3 files in podcasts cache folder either there are no downloaded podcasts or something changed in podcasts app
original error: ${e}`);
  }
}

async function exportPodcasts(podcastsDBData) {
  const cacheFilesPath = await getPodcastsCacheFilesPath();
  const podcastMP3Files = await getPodcastsCacheMP3Files(cacheFilesPath);
  const filesWithDBData = podcastMP3Files.map((fileName) => {
    const uuid = fileName.replace(".mp3", "");
    const dbMeta = podcastsDBData.find((m) => m.zuuid === uuid);
    return {
      fileName,
      uuid,
      path: `${cacheFilesPath}/${fileName}`,
      dbMeta,
    };
  });
  const outputDir = getOutputDirPath();
  await fs.mkdir(outputDir, { recursive: true });

  const podcastsByTitle = groupBy(
    filesWithDBData,
    (ep) => ep.dbMeta?.ztitle ?? "Unknown Artist"
  );

  await Promise.all(
    Object.entries(podcastsByTitle).map(async ([podcastTitle, episodes]) => {
      await fs.mkdir(`${outputDir}/${sanitize(podcastTitle)}`, {
        recursive: true,
      });

      for (let episode of episodes) {
        const newFileName =
          episode.dbMeta?.zcleanedtitle ??
          (await getMP3MetaTitle(episode.path)) ??
          episode.uuid;

        const newPath = `${outputDir}/${sanitize(podcastTitle)}/${sanitize(
          newFileName
        )}.mp3`;
        console.log(newPath);

        await fs
          .copyFile(episode.path, newPath)
          .catch((err) => console.error(err));

        const tags = {
          title: newFileName,
          artist: podcastTitle,
          album: podcastTitle,
          performerInfo: podcastTitle,
        };

        await NodeID3.write(tags, newPath);
      }
    })
  );
  console.log(`\n\nSuccessful Export to '${outputDir}' folder!`);
  exec(`open ${outputDir}`);
}

async function main() {
  const dbPodcastData = await tryGetDBPodcastsData();
  await exportPodcasts(dbPodcastData);
}

main();
