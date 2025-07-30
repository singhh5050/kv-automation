import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_UPLOADER_KEY!,
    secretAccessKey: process.env.S3_UPLOADER_SECRET!,
  },
});

export async function GET(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename");
  if (!filename) {
    return NextResponse.json({ error: "filename required" }, { status: 400 });
  }

  try {
    // Create unique key with timestamp prefix to avoid collisions
    const key = `${Date.now()}-${filename}`;
    
    const cmd = new PutObjectCommand({
      Bucket: "kv-board-decks-prod",
      Key: key,
      ContentType: "application/pdf",
    });

    const url = await getSignedUrl(s3, cmd, { expiresIn: 900 }); // 15 min
    
    return NextResponse.json({ 
      url, 
      key,
      bucket: "kv-board-decks-prod"
    });
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return NextResponse.json(
      { error: "Failed to generate presigned URL" },
      { status: 500 }
    );
  }
} 