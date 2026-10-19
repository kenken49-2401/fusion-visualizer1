// Keep failed checks readable through GitHub's annotations as well as console logs.
const escape = value => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export default async function* githubTestReporter(events) {
  for await (const event of events) {
    if (event.type !== 'test:fail') continue;
    const { name, details } = event.data;
    const error = details?.error;
    const message = error?.cause?.stack || error?.stack || error?.message || 'Test failed';
    yield `::error::${escape(`${name}\n${message}`)}\n`;
  }
}
