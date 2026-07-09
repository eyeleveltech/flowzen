export const docsHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flowzen Developer API Documentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #0B0F19;
      --bg-sidebar: #111827;
      --bg-card: #1F2937;
      --border-color: #374151;
      --text-main: #F3F4F6;
      --text-muted: #9CA3AF;
      --primary: #3B82F6;
      --primary-hover: #2563EB;
      --accent: #10B981;
      --danger: #EF4444;
      --warning: #F59E0B;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      display: flex;
      min-height: 100vh;
      line-height: 1.6;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      background-color: var(--bg-sidebar);
      border-right: 1px solid var(--border-color);
      padding: 2rem 1.5rem;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
    }

    .logo-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 2.5rem;
    }

    .logo-text {
      font-size: 1.25rem;
      font-weight: 700;
      letter-spacing: -0.025em;
      color: var(--text-main);
    }

    .logo-icon {
      background: linear-gradient(135deg, var(--primary), var(--accent));
      width: 32px;
      height: 32px;
      border-radius: 8px;
    }

    .nav-section-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
      font-weight: 600;
    }

    .nav-links {
      list-style: none;
      margin-bottom: 2rem;
    }

    .nav-links li {
      margin-bottom: 0.5rem;
    }

    .nav-links a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      display: block;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .nav-links a:hover, .nav-links a.active {
      color: var(--text-main);
      background-color: var(--bg-card);
      font-weight: 500;
    }

    /* Main Content */
    .main-content {
      margin-left: 280px;
      flex: 1;
      padding: 3rem 4rem;
      max-width: 1000px;
    }

    header {
      margin-bottom: 3rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1.5rem;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 0.5rem;
    }

    h2 {
      font-size: 1.75rem;
      font-weight: 700;
      margin-top: 3rem;
      margin-bottom: 1rem;
      letter-spacing: -0.02em;
    }

    h3 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
    }

    p {
      color: var(--text-muted);
      margin-bottom: 1.5rem;
      font-size: 0.975rem;
    }

    code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      background-color: #1E293B;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      color: #38BDF8;
    }

    pre {
      background-color: #0F172A;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.25rem;
      overflow-x: auto;
      margin-bottom: 1.5rem;
      position: relative;
    }

    pre code {
      background-color: transparent;
      padding: 0;
      color: #E2E8F0;
      font-size: 0.85rem;
    }

    /* Method Badges */
    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 700;
      color: white;
      text-transform: uppercase;
      margin-right: 0.5rem;
      font-family: 'Inter', sans-serif;
    }

    .badge-get { background-color: var(--accent); }
    .badge-post { background-color: var(--primary); }
    .badge-patch { background-color: var(--warning); }
    .badge-delete { background-color: var(--danger); }

    /* Cards */
    .card {
      background-color: var(--bg-sidebar);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }

    .alert {
      background-color: rgba(59, 130, 246, 0.1);
      border-left: 4px solid var(--primary);
      border-radius: 0 8px 8px 0;
      padding: 1rem 1.25rem;
      margin-bottom: 2rem;
    }

    .alert-warning {
      background-color: rgba(245, 158, 11, 0.1);
      border-left: 4px solid var(--warning);
    }

    .alert-title {
      font-weight: 600;
      margin-bottom: 0.25rem;
      font-size: 0.95rem;
    }

    .endpoint-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 1rem;
    }

    .parameter-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5rem;
      font-size: 0.9rem;
    }

    .parameter-table th, .parameter-table td {
      text-align: left;
      padding: 0.75rem;
      border-bottom: 1px solid var(--border-color);
    }

    .parameter-table th {
      color: var(--text-main);
      font-weight: 600;
    }

    .parameter-table td {
      color: var(--text-muted);
    }

    .param-name {
      font-family: 'JetBrains Mono', monospace;
      color: var(--primary);
      font-weight: 500;
    }

    .param-type {
      font-size: 0.8rem;
      font-style: italic;
    }

    .param-req {
      color: var(--danger);
      font-size: 0.75rem;
      font-weight: 600;
    }

    .copy-btn {
      position: absolute;
      right: 10px;
      top: 10px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .copy-btn:hover {
      color: var(--text-main);
      background: var(--border-color);
    }

    @media (max-width: 768px) {
      body {
        flex-direction: column;
      }
      .sidebar {
        width: 100%;
        height: auto;
        position: relative;
      }
      .main-content {
        margin-left: 0;
        padding: 2rem 1.5rem;
      }
    }
  </style>
</head>
<body>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="logo-container">
      <div class="logo-icon"></div>
      <span class="logo-text">Flowzen API</span>
    </div>
    
    <div class="nav-section-title">Getting Started</div>
    <ul class="nav-links">
      <li><a href="#overview" class="active">Overview</a></li>
      <li><a href="#authentication">Authentication</a></li>
      <li><a href="#responses">Standard Envelopes</a></li>
    </ul>

    <div class="nav-section-title">Leads API</div>
    <ul class="nav-links">
      <li><a href="#get-leads">GET /leads</a></li>
      <li><a href="#get-lead-id">GET /leads/:id</a></li>
      <li><a href="#post-leads">POST /leads</a></li>
      <li><a href="#patch-leads">PATCH /leads/:id</a></li>
      <li><a href="#convert-lead">POST /leads/:id/convert</a></li>
    </ul>

    <div class="nav-section-title">Tasks API</div>
    <ul class="nav-links">
      <li><a href="#get-tasks">GET /tasks</a></li>
      <li><a href="#post-tasks">POST /tasks</a></li>
      <li><a href="#patch-tasks">PATCH /tasks/:id</a></li>
    </ul>

    <div class="nav-section-title">Projects API</div>
    <ul class="nav-links">
      <li><a href="#get-projects">GET /projects</a></li>
      <li><a href="#get-project-id">GET /projects/:id</a></li>
      <li><a href="#post-projects">POST /projects</a></li>
    </ul>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    <header>
      <h1>Developer API Reference</h1>
      <p>Integrate Flowzen CRM, Projects, and Task management programmatically into your custom applications, bots, or automation builders like Zapier and Make.com.</p>
    </header>

    <!-- Overview -->
    <section id="overview">
      <h2>Overview</h2>
      <p>All API endpoints described in this reference are prefixed with the base path:</p>
      <pre><code>http://localhost:4000/api/v1</code></pre>
      <p>Requests must be sent using <code>HTTPS</code> in production. Payloads sent via <code>POST</code> and <code>PATCH</code> operations must contain the <code>Content-Type: application/json</code> header.</p>
    </section>

    <!-- Authentication -->
    <section id="authentication">
      <h2>Authentication</h2>
      <p>Authenticate your requests by passing your workspace API Key as a query string parameter named <code>apiKey</code> in every request URL:</p>
      <pre><code>GET /api/v1/leads?apiKey=YOUR_API_KEY</code></pre>
      <div class="alert alert-warning">
        <div class="alert-title">Keep your API Key safe</div>
        <p>API keys carry full administrative permissions for your organization workspace. Do not share your API keys or commit them to public version control repositories.</p>
      </div>
    </section>

    <!-- Envelopes -->
    <section id="responses">
      <h2>Standardized Response Format</h2>
      <p>All public API routes return a standardized response envelope shape to make parsing predictable.</p>
      
      <h3>Success Envelope</h3>
      <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>{
  "success": true,
  "data": {
    "id": "cmrd32gmv0003vjt42okclcnq",
    "company_name": "Apple Inc"
  }
}</code></pre>

      <h3>Paginated List Envelope</h3>
      <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>{
  "success": true,
  "data": [
    { "id": "cmrd32gmv0003vjt42okclcnq", "company_name": "Apple Inc" }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 55
  }
}</code></pre>

      <h3>Error Envelope</h3>
      <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>{
  "success": false,
  "error": "Invalid API key",
  "code": 401
}</code></pre>
    </section>

    <!-- Leads Endpoints -->
    <section id="get-leads">
      <h2>Leads API</h2>
      <div class="card">
        <div class="endpoint-row">
          <span class="badge badge-get">GET</span>
          <span>/leads</span>
        </div>
        <p>Fetch and query CRM pipeline leads. Supports pagination and multiple field filters.</p>
        
        <h3>Query Parameters</h3>
        <table class="parameter-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="param-name">stage</td>
              <td class="param-type">string</td>
              <td>Filter leads in a specific stage (e.g. <code>1. New Lead</code>, <code>8. Closed Won</code>)</td>
            </tr>
            <tr>
              <td class="param-name">assigned</td>
              <td class="param-type">string</td>
              <td>Filter by assigned team member's name</td>
            </tr>
            <tr>
              <td class="param-name">from</td>
              <td class="param-type">string (ISO Date)</td>
              <td>Filter leads created after or on this date</td>
            </tr>
            <tr>
              <td class="param-name">to</td>
              <td class="param-type">string (ISO Date)</td>
              <td>Filter leads created before or on this date</td>
            </tr>
            <tr>
              <td class="param-name">limit</td>
              <td class="param-type">number</td>
              <td>Number of records to return. Default: <code>100</code></td>
            </tr>
            <tr>
              <td class="param-name">page</td>
              <td class="param-type">number</td>
              <td>Page offset parameter. Default: <code>1</code></td>
            </tr>
          </tbody>
        </table>

        <h3>Example Response</h3>
        <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>{
  "success": true,
  "data": [
    {
      "id": "cmrd32gmv0003vjt42okclcnq",
      "company_name": "Apple Inc",
      "contact_name": "Kevin Lead",
      "contact_email": "kevin@apple.com",
      "stage": "4. Discovery Done",
      "monthly_value": 8500,
      "assigned_to": {
        "id": "cmqukbvew0001vjdgk4gqq29g",
        "name": "Basha",
        "role": "SUPER_ADMIN"
      },
      "last_contact_date": "2026-07-09",
      "created_at": "2026-07-09T05:45:47.192Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 1,
    "total": 55
  }
}</code></pre>
      </div>

      <div class="card" id="get-lead-id">
        <div class="endpoint-row">
          <span class="badge badge-get">GET</span>
          <span>/leads/:id</span>
        </div>
        <p>Retrieve detailed history and timeline details of a single lead by its identifier.</p>
        <h3>Example Response</h3>
        <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>{
  "success": true,
  "data": {
    "id": "cmrd32gmv0003vjt42okclcnq",
    "company_name": "Apple Inc",
    "contact_name": "Kevin Lead",
    "activities": [
      {
        "id": "cmrd41n...",
        "type": "STAGE_CHANGED",
        "summary": "changed stage to Discovery Done",
        "activity_date": "2026-07-09T05:52:28.038Z"
      }
    ]
  }
}</code></pre>
      </div>

      <div class="card" id="post-leads">
        <div class="endpoint-row">
          <span class="badge badge-post">POST</span>
          <span>/leads</span>
        </div>
        <p>Create a new lead in your CRM pipeline. Creates an associated client wrapper automatically.</p>
        <h3>Request Body</h3>
        <table class="parameter-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Requirement</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="param-name">company_name</td>
              <td class="param-type">string</td>
              <td class="param-req">Required</td>
              <td>Name of the lead's company</td>
            </tr>
            <tr>
              <td class="param-name">contact_name</td>
              <td class="param-type">string</td>
              <td>Optional</td>
              <td>Lead contact person's name</td>
            </tr>
            <tr>
              <td class="param-name">contact_email</td>
              <td class="param-type">string</td>
              <td>Optional</td>
              <td>Contact email address</td>
            </tr>
            <tr>
              <td class="param-name">monthly_value</td>
              <td class="param-type">number</td>
              <td>Optional</td>
              <td>Estimated monthly deal value</td>
            </tr>
          </tbody>
        </table>

        <h3>Example Response</h3>
        <pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code>{
  "success": true,
  "data": {
    "id": "cmrd5f1...",
    "company_name": "Tesla Inc",
    "stage": "1. New Lead",
    "monthly_value": 15000,
    "created_at": "2026-07-09T06:30:12.192Z"
  }
}</code></pre>
      </div>

      <div class="card" id="patch-leads">
        <div class="endpoint-row">
          <span class="badge badge-patch">PATCH</span>
          <span>/leads/:id</span>
        </div>
        <p>Update properties of an existing lead (such as moving the stage, adding notes, or assigning the lead to another user).</p>
        <h3>Request Body</h3>
        <table class="parameter-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="param-name">stage</td>
              <td class="param-type">string</td>
              <td>Move the lead stage (e.g. <code>2. First Contact Made</code>, <code>6. Proposal Sent</code>)</td>
            </tr>
            <tr>
              <td class="param-name">value / monthly_value</td>
              <td class="param-type">number</td>
              <td>Update the deal's monthly contract value</td>
            </tr>
            <tr>
              <td class="param-name">notes</td>
              <td class="param-type">string</td>
              <td>Create and append a new meeting note to the lead history</td>
            </tr>
            <tr>
              <td class="param-name">assigned_user_id</td>
              <td class="param-type">string</td>
              <td>Reassign the lead owner identifier</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" id="convert-lead">
        <div class="endpoint-row">
          <span class="badge badge-post">POST</span>
          <span>/leads/:id/convert</span>
        </div>
        <p>Convert a warm lead into a won client. This operation automatically sets client status to active, triggers project onboarding workflows, and assigns managers.</p>
      </div>
    </section>

    <!-- Tasks Endpoints -->
    <section id="get-tasks">
      <h2>Tasks API</h2>
      <div class="card">
        <div class="endpoint-row">
          <span class="badge badge-get">GET</span>
          <span>/tasks</span>
        </div>
        <p>Fetch tasks. Supports filtering by link targets (such as filtering all tasks linked to a specific lead or project).</p>
        <h3>Query Parameters</h3>
        <table class="parameter-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="param-name">linked_to</td>
              <td class="param-type">string</td>
              <td>Must be <code>lead</code> or <code>project</code></td>
            </tr>
            <tr>
              <td class="param-name">linked_id</td>
              <td class="param-type">string</td>
              <td>The ID of the parent lead or project record</td>
            </tr>
            <tr>
              <td class="param-name">status</td>
              <td class="param-type">string</td>
              <td>Filter by status: <code>not_started</code>, <code>in_progress</code>, <code>review</code>, <code>completed</code></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" id="post-tasks">
        <div class="endpoint-row">
          <span class="badge badge-post">POST</span>
          <span>/tasks</span>
        </div>
        <p>Bulk create task lists under a single parent lead or project.</p>
        <h3>Request Body</h3>
        <pre><code>{
  "tasks": [
    {
      "title": "Send Onboarding Form",
      "linked_to": "project",
      "linked_id": "cmrd43qej0001vj80jt197w9n",
      "priority": "high",
      "due_date": "2026-07-15"
    }
  ]
}</code></pre>
      </div>

      <div class="card" id="patch-tasks">
        <div class="endpoint-row">
          <span class="badge badge-patch">PATCH</span>
          <span>/tasks/:id</span>
        </div>
        <p>Update task status (e.g. marking it completed) or overwrite task details.</p>
      </div>
    </section>

    <!-- Projects Endpoints -->
    <section id="get-projects">
      <h2>Projects API</h2>
      <div class="card">
        <div class="endpoint-row">
          <span class="badge badge-get">GET</span>
          <span>/projects</span>
        </div>
        <p>List and query projects for the organization workspace.</p>
      </div>

      <div class="card" id="get-project-id">
        <div class="endpoint-row">
          <span class="badge badge-get">GET</span>
          <span>/projects/:id</span>
        </div>
        <p>Fetch details of a single project including members, active milestones, and task checklists.</p>
      </div>

      <div class="card" id="post-projects">
        <div class="endpoint-row">
          <span class="badge badge-post">POST</span>
          <span>/projects</span>
        </div>
        <p>Create a project, link client wrappers, project managers, and initialize teams.</p>
        <h3>Request Body</h3>
        <pre><code>{
  "name": "E-Commerce Re-design",
  "type": "ONE_TIME",
  "priority": "HIGH",
  "budget": 12500
}</code></pre>
      </div>
    </section>
  </main>

  <script>
    function copyCode(btn) {
      const codeBlock = btn.nextElementSibling;
      navigator.clipboard.writeText(codeBlock.textContent);
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
  </script>
</body>
</html>
`;
