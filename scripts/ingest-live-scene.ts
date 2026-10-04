import { ingestLiveScene } from '../server/liveScene';
import { disconnectSpacetime, persistLiveScene } from '../server/spacetime';

const offline = process.argv.includes('--offline');

const result = await ingestLiveScene({
  offline,
  persist: persistLiveScene,
});
disconnectSpacetime();

console.log(
  JSON.stringify(
    {
      imageId: result.record.imageId,
      sol: result.record.sol,
      camera: result.record.camera,
      utcDateTaken: result.record.utcDateTaken,
      localMeanSolarTime: result.record.localMeanSolarTime,
      daysAgo: result.record.daysAgo,
      filePath: result.record.filePath,
      nasaUrl: result.record.nasaUrl,
      credit: result.record.credit,
      isFallback: result.record.isFallback,
      chosenWhy: result.record.chosenWhy,
      lat: result.record.lat,
      lon: result.record.lon,
      waypointSol: result.record.waypointSol,
      persisted: result.persisted,
      persistError: result.persistError,
    },
    null,
    2,
  ),
);

if (!result.persisted) {
  process.exitCode = 1;
}
