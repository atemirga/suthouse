import { recomputeFifoCosts } from '../src/lib/sync/fifo';

recomputeFifoCosts()
  .then((s) => {
    console.log(JSON.stringify(s, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
