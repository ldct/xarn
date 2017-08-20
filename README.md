# xarn
A package manager that uses a SAT solver for dependency resolution. Highly experimental.

## Inspiration

https://yarnpkg.com/blog/2017/07/11/lets-dev-a-package-manager/

meteorjs also uses a SAT solver

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

The dependency graph shows which which packages depend on what, and in which way. For instance, `tar-stream@1.5.4` is a concrete package with 4 dependencies, the first of which is `bl@^1.0.0`. `bl@^1.0.0` is not a concrete package but contains a semver range; hence it can be satisfied by any of the 8 concrete packages (`bl@1.0.0`, `bl@1.0.2`, ...`bl@1.2.1`).

In general there are two types of variables, representing 1. concrete packages and 2. package ranges.

1. Concrete packages are packages at a pinned version. We get their dependencies by examining their `package.json` file, and all dependencies must be satisified (hence the `AND`). Their dependencies are usually package ranges.
2. Package ranges are packages at a semver range. They are satisfied by any concerte package of the same name at a a version allowed by the semver rules. Their dependencies are always concerte packages. We query the npm registry to find the finite set of concrete packages that satisfy a package range.

The special `root` dependency represents the package the user requested.

### Satisfying Solution

```
[ 'bl@1.0.0',
  'core-util-is@1.0.2',
  'end-of-stream@1.1.0',
  'inherits@2.0.3',
  'isarray@0.0.1',
  'once@1.3.0',
  'process-nextick-args@1.0.7',
  'readable-stream@2.0.3',
  'string_decoder@0.10.31',
  'tar-stream@1.5.4',
  'util-deprecate@1.0.2',
  'xtend@4.0.0' ]
```

By representing both package ranges and concerte packages as variables, we can ship the dependency graph off directly to a SAT solver, in this case MINISAT. We ask for a satisfying solution (set of variables) with the smallest number of true variables, but other optimizations are conceivable.

We don't really need the complete solution set, however, just the set of concrete packages to be installed.

### Link Tree

Now we just install all the modules in our solution set. Unlike a normal npm/yarn link tree, we install all of them at the base `node_modules` directory with the explicit reference. This allows multiple versions of the same package to coexist at the top. However, since node searches for the explicity package name (with no version), we create a symlink for the root package.

```
➜  xarn-test ls -l node_modules
total 8
drwxr-xr-x   8  272 Aug 19 22:24 bl@1.0.0
drwxr-xr-x   9  306 Aug 19 22:24 core-util-is@1.0.2
drwxr-xr-x   8  272 Aug 19 22:24 end-of-stream@1.1.0
drwxr-xr-x   8  272 Aug 19 22:24 inherits@2.0.3
drwxr-xr-x   8  272 Aug 19 22:24 isarray@0.0.1
drwxr-xr-x   8  272 Aug 19 22:24 once@1.3.0
drwxr-xr-x   8  272 Aug 19 22:24 process-nextick-args@1.0.7
drwxr-xr-x  13  442 Aug 19 22:24 readable-stream@2.0.3
drwxr-xr-x   7  238 Aug 19 22:24 string_decoder@0.10.31
lrwxr-xr-x   1   53 Aug 19 22:24 tar-stream -> /Users/xuanji/xarn-test/node_modules/tar-stream@1.5.4
drwxr-xr-x  10  340 Aug 19 22:24 tar-stream@1.5.4
drwxr-xr-x   9  306 Aug 19 22:24 util-deprecate@1.0.2
drwxr-xr-x  10  340 Aug 19 22:24 xtend@4.0.0
```

We also need to do the same for each dependency. Instead of a nested tree structure like in npm/yarn, dependencies of dependencies are always symlinks to concrete packages in the base `node_modules`.

```
➜  xarn-test ls -l node_modules/tar-stream@1.5.4/node_modules
total 32
lrwxr-xr-x  1  45 Aug 19 22:24 bl -> /Users/xuanji/xarn-test/node_modules/bl@1.0.0
lrwxr-xr-x  1  56 Aug 19 22:24 end-of-stream -> /Users/xuanji/xarn-test/node_modules/end-of-stream@1.1.0
lrwxr-xr-x  1  58 Aug 19 22:24 readable-stream -> /Users/xuanji/xarn-test/node_modules/readable-stream@2.0.3
lrwxr-xr-x  1  48 Aug 19 22:24 xtend -> /Users/xuanji/xarn-test/node_modules/xtend@4.0.0
```

We also print the link tree

```
string_decoder@0.10.31
readable-stream@2.0.3
└──core-util-is@~1.0.0 -> 1.0.2
└──inherits@~2.0.1 -> 2.0.3
└──isarray@0.0.1 -> 0.0.1
└──process-nextick-args@~1.0.0 -> 1.0.7
└──string_decoder@~0.10.x -> 0.10.31
└──util-deprecate@~1.0.1 -> 1.0.2
process-nextick-args@1.0.7
once@1.3.0
isarray@0.0.1
inherits@2.0.3
end-of-stream@1.1.0
└──once@~1.3.0 -> 1.3.0
core-util-is@1.0.2
bl@1.0.0
└──readable-stream@~2.0.0 -> 2.0.3
xtend@4.0.0
util-deprecate@1.0.2
tar-stream@1.5.4
└──bl@^1.0.0 -> 1.0.0
└──end-of-stream@^1.0.0 -> 1.1.0
└──readable-stream@^2.0.0 -> 2.0.3
└──xtend@^4.0.0 -> 4.0.0
```

## Disadvantages

This reads a ton of data from the npm registry, basically it needs to know the tranistive closure of the dependencies at every version. Also, the "minimize true" heuristic is pretty poor, in this case choosing an older version of `bl` just because the new version split out some dependencies.

In the presence of peerDependencies, optimization targets like "recency" may form a lattice with multiple solutions, none of which are better than the others.

## Missing features

Binaries, devDependencies, tests, install scripts...basically, we only read the `dependencies` field of `package.json`, so anything configured with any other field does not work now.

## Future work

### flat mode

We can probably implement `flat` mode without any manual user input

## peerDependencies

https://github.com/yarnpkg/yarn/issues/422

## Testing

It would be fun to use this to run project tests to see which projects had implicitly depended on npm/yarn's "choose the newest satisfying package" resolution behaviour, ie had inaccurate semver ranges.
