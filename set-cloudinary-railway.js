/**
 * Sets Cloudinary env vars on Railway via GraphQL API.
 * Run: node set-cloudinary-railway.js
 */
const https = require('https');

const TOKEN = 'rw_Fe26.2**b17a1bf1bee583cd927b09c30eaf91b7dcde79745b03af9724a4c08308f540c3*j7sJyjURZ-DU_FFWSl_qMQ*mh7ew0PqWGGrKIbJnooLFlN7ADd92aayAyPiWg7xrvtIRgjbDKkzcXt6P1qZ32M_Gk_zy6hJeMV3fqzUknvj0Q*1774096931886*c56464a1cf843da10772b6e65c4ebff1c3d709c690161426a897ec4bd1140f6f*00O3YMLd3FjDC8K_KA8b9k5Jl9NApCQkI60UgieiTEw';

const gql = (query, variables = {}) => new Promise((resolve, reject) => {
  const body = JSON.stringify({ query, variables });
  const req = https.request({
    hostname: 'backboard.railway.com',
    path: '/graphql/v2',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Length': Buffer.byteLength(body),
    },
  }, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error(`Parse error: ${data}`)); }
    });
  });
  req.on('error', reject);
  req.write(body);
  req.end();
});

async function main() {
  // 1. Get projects — try both query forms
  let projectList = [];
  const r1 = await gql(`{ me { projects { edges { node { id name } } } } }`);
  projectList = r1?.data?.me?.projects?.edges || [];
  if (!projectList.length) {
    const r2 = await gql(`{ projects { edges { node { id name } } } }`);
    projectList = r2?.data?.projects?.edges || [];
  }
  if (!projectList.length) {
    // Hardcode the project ID from the Railway URL seen in deploy output
    // https://railway.com/project/9924b31e-f5ca-4e57-b626-307209e61365
    console.log('Could not list projects via API — using hardcoded project ID');
    projectList = [{ node: { id: '9924b31e-f5ca-4e57-b626-307209e61365', name: 'HNU Portal' } }];
  }
  console.log('Projects:', projectList.map(e => `${e.node.name} (${e.node.id})`));

  const project = projectList.find(e => e.node.name.toLowerCase().includes('hnu') || e.node.name.toLowerCase().includes('portal'));
  if (!project) { console.error('Could not find HNU Portal project'); return; }
  const projectId = project.node.id;
  console.log(`\nUsing project: ${project.node.name} (${projectId})`);

  // 2. Get environments
  const envs = await gql(`query($id:String!){ project(id:$id){ environments{ edges{ node{ id name } } } } }`, { id: projectId });
  const envList = envs?.data?.project?.environments?.edges || [];
  console.log('Environments:', envList.map(e => `${e.node.name} (${e.node.id})`));
  const env = envList.find(e => e.node.name === 'production') || envList[0];
  const environmentId = env.node.id;
  console.log(`Using environment: ${env.node.name} (${environmentId})`);

  // 3. Get services
  const services = await gql(`query($id:String!){ project(id:$id){ services{ edges{ node{ id name } } } } }`, { id: projectId });
  const serviceList = services?.data?.project?.services?.edges || [];
  console.log('Services:', serviceList.map(e => `${e.node.name} (${e.node.id})`));
  const service = serviceList.find(e => e.node.name.toLowerCase().includes('hnu') || e.node.name.toLowerCase().includes('portal') || e.node.name.toLowerCase().includes('backend'));
  if (!service) { console.error('Could not find backend service'); return; }
  const serviceId = service.node.id;
  console.log(`Using service: ${service.node.name} (${serviceId})`);

  // 4. Set each var
  const vars = {
    CLOUDINARY_CLOUD_NAME:  'dhlvzepp6',
    CLOUDINARY_API_KEY:     '843524639436499',
    CLOUDINARY_API_SECRET:  'gI1ZuNhXnRKwP4Gq_E6wrQoX7CU',
  };

  for (const [name, value] of Object.entries(vars)) {
    const result = await gql(
      `mutation($input: VariableUpsertInput!) { variableUpsert(input: $input) }`,
      { input: { projectId, environmentId, serviceId, name, value } }
    );
    if (result.errors) {
      console.error(`❌ ${name}:`, result.errors[0]?.message);
    } else {
      console.log(`✅ ${name} set`);
    }
  }

  console.log('\n✅ Done — Railway will redeploy automatically.');
}

main().catch(e => console.error('Fatal:', e.message));


