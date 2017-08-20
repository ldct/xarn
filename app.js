const fetch = require('node-fetch');
const semver = require('semver');
const {extractArchiveTo} = require('./utilities');
const pMemoize = require('p-memoize');
const _ = require('lodash');
const Logic = require('logic-solver');
const fs = require('fs');
const execSync = require('child_process').execSync;
const exec = require('child_process').exec;
const assert = require('assert');

async function fetchPackage(name, reference) {
  assert(semver.valid(reference));
  return await fetchUrlAsBuffer(`https://registry.yarnpkg.com/${name}/-/${name}-${reference}.tgz`)
}

function orderify(unordered) {
  const ordered = {};
  Object.keys(unordered).sort().forEach(function(key) {
    ordered[key] = unordered[key];
  });
  return ordered;
}

async function fetchUrlAsJson(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Couldn't fetch package "${url}"`);
  const body = await response.text();
  return JSON.parse(body);
}

class OrNode {
  constructor(arr) {
    this.arr = arr;
  }
  toString() {
    return JSON.stringify(this);
  }
  inspect () {
    return `OR(${this.arr.join(', ')})`;
  }
}

class AndNode {
  constructor(arr) {
    this.arr = arr;
  }
  toString() {
    return JSON.stringify(this);
  }
  inspect () {
    return `AND(${this.arr.join(', ')})`;
  }
}

async function getDependencyGraph(name, reference) {

  var dependencies = {};
  dependencies["root"] = new AndNode([`${name}@${reference}`]);

  async function populateDependencies(name, reference) {
    const key = `${name}@${reference}`;
    // console.log(key);
    if (dependencies[key] !== undefined) {
      return;
    }
    if (semver.valid(reference)) {
      const pi = (await fetchPackageInfo(name)).versions[reference];
      if (pi === undefined) {
        throw "reference not found in registry";
      }
      if (pi.dependencies === undefined) {
        pi.dependencies = {};
      }
      assert(pi.peerDependencies === undefined);
      const deps = Object.keys(pi.dependencies).map(packageName => {
        return `${packageName}@${pi.dependencies[packageName]}`;
      });
      dependencies[key] = new AndNode(deps);
      for (let packageName of Object.keys(pi.dependencies)) {
        const version = pi.dependencies[packageName];
        await populateDependencies(packageName, version);
      }
    } else {
      const all_versions = await fetchPackageVersions(name);
      const matching_versions = _.filter(all_versions, (version) => {
        return semver.satisfies(version, reference);
      });
      const matching_named_versions = _.map(matching_versions, (version) => {
        return `${name}@${version}`
      });
      dependencies[key] = new OrNode(matching_named_versions);
      await Promise.all(matching_versions.map(version => populateDependencies(name, version)));
    }
  }

  await populateDependencies(name, reference)

  return orderify(dependencies);

}

async function doFetchPackageInfo(name) {
  return await fetchUrlAsJson(`https://registry.npmjs.org/${name}`);
}
const fetchPackageInfo = pMemoize(doFetchPackageInfo);

async function fetchPackageVersions(name) {
  const j = await fetchPackageInfo(name);
  return Object.keys(j.versions);
}


async function fetchUrlAsBuffer(url) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Couldn't fetch package "${url}"`);
  return await response.buffer();
}

function getSatisfyingInstalls(deps) {
    var solver = new Logic.Solver();
    solver.require('root');

    for (let variable of Object.keys(deps)) {
      const varDeps = deps[variable];
      if (varDeps instanceof OrNode) {
        solver.require(Logic.implies(variable, Logic.or(varDeps.arr)));
      } else if (varDeps instanceof AndNode) {
        solver.require(Logic.implies(variable, Logic.and(varDeps.arr)));
      } else {
        assert(false);
      }
    }

    const solution = solver.solve();
    solver.minimizeWeightedSum(solution, Object.keys(deps), 1);
    const solution2 = solver.solve();
    return solution2.getTrueVars();

}

function getConcreteVersionAmongSolutions(solution, package) {
  const [name, requirement] = package.split("@");
  for (let candidatePackage of solution) {
    if (candidatePackage === "root") continue;
    const [candidateName, candidateVersion] = candidatePackage.split("@");
    if (!semver.valid(candidateVersion)) continue;
    if (candidateName !== name) continue;
    if (semver.satisfies(candidateVersion, requirement)) {
      version = candidateVersion;
    }
  }
  assert(version !== null);
  return version;
}

async function install(name, reference, dir) {
  console.log('starting install...');
  const deps = await getDependencyGraph(name, reference);
  console.log('got dependency graph');
  const solution = getSatisfyingInstalls(deps);
  console.log('solved dependency graph');

  console.log(solution);

  // clean files
  execSync(`rm -rf ${dir}/node_modules`,
    function (error, stdout, stderr) {
      if (error !== null) {
          console.log('exec error: ' + error);
      }
    });
  fs.mkdirSync(dir + '/node_modules');

  // extract packages
  await Promise.all(solution.map(package => (async function () {
    if (package === "root") return;
    const [name, version] = package.split("@");
    if (!semver.valid(version)) return;
    const buf = await fetchPackage(name, version);
    await extractArchiveTo(buf, dir + '/node_modules/' + package);
    console.log("installed", package);

    execSync(`mv ${dir}/node_modules/${package}/package/* ${dir}/node_modules/${package}; rm -rf ${dir}/node_modules/${package}/package`,
      function (error, stdout, stderr) {
          if (error !== null) {
               console.log('exec error: ' + error);
          }
      });
  })()));

  // link root
  for (let package of deps['root'].arr) {
    const version = getConcreteVersionAmongSolutions(solution, package);

    execSync(`ln -s ${dir}/node_modules/${name}@${version} ${dir}/node_modules/${name}`,
      function (error, stdout, stderr) {
        if (error !== null) {
            console.log('exec error: ' + error);
        }
      });
    console.log("linked", package);
  }

  // link subpackages
  for (let package of solution) {
    if (package === "root") continue;
    const [name, version] = package.split("@");
    if (!semver.valid(version)) continue;
    console.log('linking dependencies of', package);

    const thisDeps = deps[package];
    assert(thisDeps instanceof AndNode);

    for (let depPackage of thisDeps.arr) {
      const [depName, depRequirement] = depPackage.split("@");
      const version2 = getConcreteVersionAmongSolutions(solution, depPackage);

      execSync(`mkdir -p ${dir}/node_modules/${package}/node_modules; ln -s ${dir}/node_modules/${depName}@${version2} ${dir}/node_modules/${package}/node_modules/${depName}`,
        function (error, stdout, stderr) {
          if (error !== null) {
              console.log('exec error: ' + error);
          }
        });
      console.log("linked", depPackage);
    }

  }
}


(async function() {
  await install("tar-stream", "1.5.4", "/Users/xuanji/xarn-test");
  // console.log(await getDependencyGraph("react", "=15.0.0"));
})();
