const fetch = require('node-fetch');
const semver = require('semver');
const {extractArchiveTo} = require('./utilities');
const pMemoize = require('p-memoize');
const _ = require('lodash');
const Logic = require('logic-solver');
const fs = require('fs');
const execSync = require('child_process').execSync;

function rmDir(dirPath, removeSelf) {
  if (removeSelf === undefined)
    removeSelf = false;
  try { var files = fs.readdirSync(dirPath); }
  catch(e) { return; }
  if (files.length > 0)
    for (var i = 0; i < files.length; i++) {
      var filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile())
        fs.unlinkSync(filePath);
      else
        rmDir(filePath);
    }
  if (removeSelf)
    fs.rmdirSync(dirPath);
};

async function fetchPackage(name, reference) {
  if (semver.valid(reference)) {
    return await fetchUrlAsBuffer(`https://registry.yarnpkg.com/${name}/-/${name}-${reference}.tgz`)
  } else {
      throw new Error('not a valid semver reference')
  }
}

function orderify(unordered) {
  const ordered = {};
  Object.keys(unordered).sort().forEach(function(key) {
    ordered[key] = unordered[key];
  });
  return ordered;
}


async function fetchUrlAsJson(url) {
  let response = await fetch(url);
  if (!response.ok)
    throw new Error(`Couldn't fetch package "${url}"`);
  let body = await response.text();
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

function isExactReference(reference) {
  return reference.match(/^[0-9]*\.[0-9]*\.[0-9]*(\-.*$)?/) !== null;
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
      if (pi.peerDependencies !== undefined) {
        throw ":("
      }
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
      for (let version of matching_versions) {
        await populateDependencies(name, version);
      }
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
  let j = await fetchPackageInfo(name);
  return Object.keys(j.versions);
}


async function fetchUrlAsBuffer(url) {
  let response = await fetch(url);
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
        console.log(variable, varDeps);
        throw ":(";
      }
    }

    const solution = solver.solve();
    solver.minimizeWeightedSum(solution, Object.keys(deps), 1);
    const solution2 = solver.solve();
    return solution2.getTrueVars();

}

async function install(name, reference, dir) {
  const deps = await getDependencyGraph(name, reference);
  const solution = getSatisfyingInstalls(deps);

  console.log(deps);

  // clean files
  if (!fs.existsSync(dir + '/node_modules')){
    fs.mkdirSync(dir + '/node_modules');
  } else {
    rmDir(`${dir}/node_modules`);
  }

  // extract packages
  for (let package of solution) {
    if (package === "root") continue;
    const [name, version] = package.split("@");
    if (!semver.valid(version)) continue;
    const buf = await fetchPackage(name, version);
    await extractArchiveTo(buf, dir + '/node_modules/' + package);
    console.log("installed", package);

    execSync(`mv ${dir}/node_modules/${package}/package/* ${dir}/node_modules/${package}; rm -rf ${dir}/node_modules/${package}/package`,
      function (error, stdout, stderr) {
          if (error !== null) {
               console.log('exec error: ' + error);
          }
      });
  }

  // link root
  for (let package of deps['root'].arr) {
    const [name, requirement] = package.split("@");
    var version = null;
    for (let candidatePackage of Object.keys(deps)) {
      if (candidatePackage === "root") continue;
      const [candidateName, candidateVersion] = candidatePackage.split("@");
      if (!semver.valid(candidateVersion)) continue;
      if (candidateName !== name) continue;
      if (semver.satisfies(candidateVersion, requirement)) {
        version = candidateVersion;
      }
    }
    if (version === null) {
      console.log(':(');
    }
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
    if (!(thisDeps instanceof AndNode)) {
      console.log(":(");
    }

    for (let depPackage of thisDeps.arr) {
      const [depName, depRequirement] = depPackage.split("@");
      var version2 = null;
      for (let candidatePackage of Object.keys(deps)) {
        if (candidatePackage === "root") continue;
        if (solution.indexOf(candidatePackage) === -1) continue;
        const [candidateName, candidateVersion] = candidatePackage.split("@");
        if (!semver.valid(candidateVersion)) continue;
        if (candidateName !== depName) continue;
        if (semver.satisfies(candidateVersion, depRequirement)) {
          version2 = candidateVersion;
        }
      }
      if (version2 === null) {
        console.log(':(');
      }
      execSync(`mkdir -p ${dir}/node_modules/${package}/node_modules`,
        function (error, stdout, stderr) {
          if (error !== null) {
              console.log('exec error: ' + error);
          }
        });
      execSync(`ln -s ${dir}/node_modules/${depName}@${version2} ${dir}/node_modules/${package}/node_modules/${depName}`,
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
