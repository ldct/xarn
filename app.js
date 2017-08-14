const fetch = require('node-fetch');
const semver = require('semver');
const {readPackageJsonFromArchive} = require('./utilities');
const pMemoize = require('p-memoize');
const _ = require('lodash');

async function doFetchPackage({name, reference}) {
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

const fetchPackage = pMemoize(doFetchPackage);

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


async function populateRootDependency(name, reference) {

  var dependencies = {};
  dependencies["root"] = `${name}@${reference}`;

  async function populateDependencies(name, reference) {
    const key = `${name}@${reference}`;
    // console.log(key);
    if (dependencies[key] !== undefined) {
      return;
    }
    if (isExactReference(reference)) {
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

(async function() {
  console.log(await populateRootDependency("babel-core", "=6.25.0"));
  // console.log(await populateRootDependency("react", "=15.0.0"));
})();
