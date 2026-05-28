const { RekognitionClient, DetectFacesCommand } = require('@aws-sdk/client-rekognition');
const fs = require('fs');
require('dotenv').config();

const client = new RekognitionClient({
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

async function test() {
  try {
    // Use a test image from URL
    const response = await fetch('https://randomuser.me/api/portraits/women/68.jpg');
    const buffer = await response.arrayBuffer();
    
    const params = {
      Image: { Bytes: Buffer.from(buffer) },
      Attributes: ['ALL']
    };
    
    const command = new DetectFacesCommand(params);
    const result = await client.send(command);
    
    if (result.FaceDetails && result.FaceDetails.length > 0) {
      console.log('✅ AWS Rekognition works!');
      console.log(`Gender: ${result.FaceDetails[0].Gender.Value}`);
      console.log(`Confidence: ${result.FaceDetails[0].Gender.Confidence}%`);
    } else {
      console.log('No face detected');
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

test();	