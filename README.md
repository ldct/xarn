# xarn
A package manager

## Demo

```
mkdir -p ~/xarn-test
`./xarn.js tar-stream@1.5.4 ~/xarn-test
cp ./tar-test.js ~/xarn-test
cd ~/xarn-test
node ./tar-test.js
```

xarn runs in 3 stages; the intermediate data structures computed by each stage are printed to stdout.

### Dependency Graph

```
{ ...
  root: AND(tar-stream@1.5.4),
  ...
  'tar-stream@1.5.4': AND(bl@^1.0.0, end-of-stream@^1.0.0, readable-stream@^2.0.0, xtend@^4.0.0),
  ...
  'bl@^1.0.0': OR(bl@1.0.0, bl@1.0.1, bl@1.0.2, bl@1.0.3, bl@1.1.1, bl@1.1.2, bl@1.2.0, bl@1.2.1),
  ...
  'bl@1.0.0': AND(readable-stream@~2.0.0), 'bl@1.0.1': AND(readable-stream@~2.0.5),
  ...
}
```
