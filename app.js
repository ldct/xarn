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

var dependencies = {};

async function populateRootDependency(name, reference) {
  dependencies["root"] = `${name}@${reference}`;
  await populateDependencies(name, reference)
}

function isExactReference(reference) {
  return reference.match(/^[0-9]*\.[0-9]*\.[0-9]*(\-.*$)?/) !== null;
}

async function populateDependencies(name, reference) {
  const key = `${name}@${reference}`;
  console.log(key);
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
    if (pi.devDependencies !== undefined) {
      // TBD
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
  await populateRootDependency("react", "^15.0.0");
  console.log(dependencies);
})();
