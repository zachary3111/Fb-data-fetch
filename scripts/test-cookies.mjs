import { parseCookiesInput, validateCookies } from '../src/utils/cookies.js';

// Test different cookie formats
const testCases = [
  {
    name: 'JSON Array Format',
    input: `[
      {"name": "c_user", "value": "123456789", "domain": ".facebook.com"},
      {"name": "xs", "value": "abc123def456", "domain": ".facebook.com"},
      {"name": "datr", "value": "xyz789", "domain": ".facebook.com"}
    ]`
  },
  {
    name: 'Header Format',
    input: 'c_user=123456789; xs=abc123def456; datr=xyz789; sb=def456'
  },
  {
    name: 'Netscape Format',
    input: `# Netscape HTTP Cookie File
.facebook.com	TRUE	/	TRUE	1234567890	c_user	123456789
.facebook.com	TRUE	/	TRUE	1234567890	xs	abc123def456
.facebook.com	TRUE	/	TRUE	1234567890	datr	xyz789`
  },
  {
    name: 'Invalid Format',
    input: 'this is not a valid cookie format'
  },
  {
    name: 'Empty Input',
    input: ''
  }
];

console.log('🍪 Testing Facebook Cookie Parser\n');

const results = [];

for (const testCase of testCases) {
  console.log(`Testing: ${testCase.name}`);
  console.log(`Input: ${testCase.input.substring(0, 100)}${testCase.input.length > 100 ? '...' : ''}`);
  
  try {
    // Test parsing
    const parsed = parseCookiesInput(testCase.input);
    console.log(`✅ Parsed ${parsed.length} cookies`);
    
    if (parsed.length > 0) {
      console.log(`   Sample cookie: ${parsed[0].name}=${parsed[0].value.substring(0, 10)}...`);
      console.log(`   Domain: ${parsed[0].domain}`);
    }
    
    // Test validation
    const validation = validateCookies(testCase.input);
    console.log(`   Validation: ${validation.valid ? '✅ Valid' : '❌ Invalid'} (${validation.format || 'unknown format'})`);
    console.log(`   Message: ${validation.message || 'No message'}`);
    
    results.push({
      testCase: testCase.name,
      success: true,
      cookieCount: parsed.length,
      valid: validation.valid
    });
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    results.push({
      testCase: testCase.name,
      success: false,
      error: error.message
    });
  }
  
  console.log('');
}

// Summary
console.log('📊 Test Summary:');
console.log(`Total tests: ${results.length}`);
console.log(`Successful: ${results.filter(r => r.success).length}`);
console.log(`Failed: ${results.filter(r => !r.success).length}`);

const failed = results.filter(r => !r.success);
if (failed.length > 0) {
  console.log('\n❌ Failed tests:');
  failed.forEach(f => console.log(`  - ${f.testCase}: ${f.error}`));
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}

// Test essential cookies detection
console.log('\n🔍 Testing Essential Cookie Detection:');

const essentialTest = `[
  {"name": "c_user", "value": "123456789", "domain": ".facebook.com"},
  {"name": "xs", "value": "abc123def456", "domain": ".facebook.com"},
  {"name": "some_other", "value": "xyz", "domain": ".facebook.com"}
]`;

const essentialParsed = parseCookiesInput(essentialTest);
const hasEssential = essentialParsed.some(c => c.name === 'c_user') && 
                   essentialParsed.some(c => c.name === 'xs');

console.log(`Essential cookies present: ${hasEssential ? '✅ Yes' : '❌ No'}`);
console.log('Cookie names found:', essentialParsed.map(c => c.name).join(', '));

console.log('\n🎉 Cookie parser tests completed successfully!');
