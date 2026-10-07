window.portalDevelopmentPreview = true;

window.portalProjects = [
  { id: '01', client: 'Demo Client 01', title: 'Bathroom Renovation', reference: 'Demo reference 01', status: 'completed', note: 'Sample completed bathroom project.', kind: 'bathroom' },
  { id: '02', client: 'Demo Client 02', title: 'Bathroom Renovation', reference: 'Demo reference 02', status: 'completed', note: 'Sample completed bathroom project.', kind: 'bathroom' },
  { id: '03', client: 'Demo Client 03', title: 'Bathroom Renovation', reference: 'Demo reference 03', status: 'completed', note: 'Sample completed bathroom project.', kind: 'bathroom' },
  { id: '04', client: 'Demo Client 04', title: 'Bathroom Renovation', reference: 'Demo reference 04', status: 'completed', note: 'Sample completed bathroom project.', kind: 'bathroom' },
  { id: '05', client: 'Demo Client 05', title: 'Bathroom Renovation', reference: 'Demo reference 05', status: 'completed', note: 'Sample completed bathroom project.', kind: 'bathroom' },
  { id: '06', client: 'Demo Client 06', title: 'Bathroom Renovation', reference: 'Demo reference 06', status: 'completed', note: 'Sample completed bathroom project.', kind: 'bathroom' },
  { id: '07', client: 'Demo Client 07', title: 'Kitchen Renovation', reference: 'Demo reference 07', status: 'finishing', note: 'Sample kitchen project awaiting final fitting.', kind: 'kitchen' },
  { id: '08', client: 'Demo Client 08', title: 'Kitchen Renovation', reference: 'Demo reference 08', status: 'completed', note: 'Sample completed kitchen project.', kind: 'kitchen' },
  {
    id: '09',
    client: 'Jane Hill',
    title: 'Bathroom Renovation',
    reference: 'Job 354067 / WO198032',
    status: 'progress',
    note: 'Bathroom renovation development preview.',
    kind: 'bathroom',
    startDate: 'Monday, 5 October 2026',
    duration: '10 working days'
  }
];

window.portalStages = {
  bathroom: [
    'Strip-out & substrate inspection',
    'Subfloor prep & structural adjustments',
    'First fix plumbing & electrical',
    'Wall boarding, plastering & waterproofing',
    'Wall & floor tiling',
    'Second fix plumbing & sanitaryware',
    'Second fix electrical & lighting',
    'Finishing, snagging & handover'
  ],
  kitchen: [
    'Site preparation & strip-out',
    'Floor, wall & structural preparation',
    'First fix plumbing & electrical',
    'Cabinet installation',
    'Worktop & appliance fitting',
    'Second fix services',
    'Finishing & decoration',
    'Snagging & handover'
  ]
};
