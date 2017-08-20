var tar = require('tar-stream')
var pack = tar.pack() // pack is a streams2 stream 
 
// add a file called my-test.txt with the content "Hello World!" 
pack.entry({ name: 'my-test.txt' }, 'Hello World!')
 
// add a file called my-stream-test.txt from a stream 
var entry = pack.entry({ name: 'my-stream-test.txt', size: 11 }, function(err) {
  // the stream was added 
  // no more entries 
  pack.finalize()
})
 
entry.write('hello')
entry.write(' ')
entry.write('world')
entry.end()
 
// pipe the pack stream somewhere 
pack.pipe(process.stdout)
