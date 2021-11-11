/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable import/no-extraneous-dependencies */
import { Octokit } from '@octokit/rest';
import minimist from 'minimist';
// Generated by GitHub workflow .github/workflows/snyk-github-issue-creator
import synkJsonOutput from '../snyk.json';

type Vulnerability = {
  description: string;
  packages: {
    name: string;
    target: string;
  }[];
  snykId: string;
};

const argv = minimist(process.argv.slice(2));

const GH_OWNER = 'backstage';
const GH_REPO = 'backstage';
const SNYK_GH_LABEL = 'snyk-vulnerability';
const SNYK_ID_REGEX = /\[([A-Z0-9-:]+)]/i;

const isDryRun = 'dryrun' in argv;

if (!process.env.GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is not set. Please provide a Github token');
  process.exit(1);
}

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

if (isDryRun) {
  console.log(
    '⚠️  Running in dryrun mode, no issues will be updated on Github ⚠️',
  );
}

const fetchSnykGithubIssueMap = async (): Promise<Record<string, number>> => {
  const snykGithubIssueMap: Record<string, number> = {};

  const iterator = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
    owner: GH_OWNER,
    repo: GH_REPO,
    per_page: 100,
    state: 'open',
    labels: SNYK_GH_LABEL,
  });

  for await (const { data: issues } of iterator) {
    for (const issue of issues) {
      // Gets the Vulnerability ID from square braces
      const match = SNYK_ID_REGEX.exec(issue.title);

      if (match && match[1]) {
        snykGithubIssueMap[match[1]] = issue.number;
      } else {
        console.log(`Unmatched Snyk ID for ${issue.title}`);
      }
    }
  }

  return snykGithubIssueMap;
};

const generateIssueBody = (vulnerability: Vulnerability) => `
## Affecting Packages/Plugins

${Array.from(vulnerability.packages)
  .map(({ name, target }) => `* [${name}](${target})`)
  .join('\n')}

${vulnerability.description}
`;

const createGithubIssue = async (vulnerability: Vulnerability) => {
  console.log(
    `Create Github Issue for Snyk Vulnerability ${vulnerability.snykId}`,
  );

  vulnerability.packages.forEach(({ name, target }) => {
    console.log(`- ${name} [${target}]`);
  });

  if (!isDryRun) {
    await octokit.issues.create({
      owner: GH_OWNER,
      repo: GH_REPO,
      title: `Snyk vulnerability [${vulnerability.snykId}]`,
      labels: [SNYK_GH_LABEL, 'help wanted'],
      body: generateIssueBody(vulnerability),
    });
  }
};

const updateGithubIssue = async (
  githubIssueId: number,
  vulnerability: Vulnerability,
) => {
  console.log(
    `Update Github Issue #${githubIssueId} for Snky Vulnerability ${vulnerability.snykId}`,
  );

  if (!isDryRun) {
    await octokit.issues.update({
      owner: GH_OWNER,
      repo: GH_REPO,
      issue_number: githubIssueId,
      body: generateIssueBody(vulnerability),
    });
  }
};

const closeGithubIssue = async (githubIssueId: number) => {
  console.log(`Closing Github Issue #${githubIssueId}`);

  if (!isDryRun) {
    await octokit.issues.update({
      owner: GH_OWNER,
      repo: GH_REPO,
      issue_number: githubIssueId,
      state: 'closed',
    });
  }
};

async function main() {
  const snykGithubIssueMap = await fetchSnykGithubIssueMap();
  const vulnerabilityStore: Record<string, Vulnerability> = {};

  // Group the Snyk vulnerabilities, and link back to the affecting packages.
  synkJsonOutput.forEach(
    ({ projectName, displayTargetFile, vulnerabilities }) => {
      vulnerabilities.forEach(
        ({ id, description }: { id: string; description: string }) => {
          if (id !== undefined && description !== undefined) {
            if (vulnerabilityStore[id]) {
              if (
                !vulnerabilityStore[id].packages.some(
                  ({ name }) => name === projectName,
                )
              ) {
                vulnerabilityStore[id].packages.push({
                  name: projectName,
                  target: displayTargetFile,
                });
              }
            } else {
              vulnerabilityStore[id] = {
                description,
                snykId: id,
                packages: [
                  {
                    name: projectName,
                    target: displayTargetFile,
                  },
                ],
              };
            }
          }
        },
      );
    },
  );

  for (const [id, vulnerability] of Object.entries(vulnerabilityStore)) {
    if (snykGithubIssueMap[id]) {
      await updateGithubIssue(snykGithubIssueMap[id], vulnerability);
    } else {
      await createGithubIssue(vulnerability);
    }
  }

  for (const [snykId, githubIssueId] of Object.entries(snykGithubIssueMap)) {
    if (!vulnerabilityStore[snykId]) {
      await closeGithubIssue(githubIssueId);
    }
  }
}

main().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
